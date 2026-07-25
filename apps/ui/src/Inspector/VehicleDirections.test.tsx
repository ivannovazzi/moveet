import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleDirections from "./VehicleDirections";
import { DirectionContext, type DirectionMap } from "@/data/context";
import type { DirectionState } from "@/hooks/useDirections";
import { clearDirectionHighlight } from "@/hooks/directionHighlightStore";
import type { Edge, Node, Position } from "@/types";

beforeEach(() => clearDirectionHighlight());

function node(coordinates: Position): Node {
  return { id: `n${coordinates.join(",")}`, coordinates, connections: [] };
}

let edgeSeq = 0;
function edge(opts: {
  name?: string;
  bearing: number;
  distance: number;
  start?: Position;
  end?: Position;
}): Edge {
  edgeSeq += 1;
  return {
    id: `e${edgeSeq}`,
    streetId: `s${edgeSeq}`,
    name: opts.name,
    start: node(opts.start ?? [0, 0]),
    end: node(opts.end ?? [0, 0]),
    distance: opts.distance,
    bearing: opts.bearing,
    highway: "residential",
    maxSpeed: 50,
    surface: "asphalt",
    oneway: false,
  };
}

function renderWithDirection(
  vehicleId: string,
  state: DirectionState | undefined,
  position?: Position
) {
  const directions: DirectionMap = new Map();
  if (state) directions.set(vehicleId, state);
  return render(
    <DirectionContext.Provider value={{ directions, setDirections: vi.fn() }}>
      <VehicleDirections vehicleId={vehicleId} position={position} />
    </DirectionContext.Provider>
  );
}

describe("VehicleDirections", () => {
  it("shows the empty state when the vehicle has no active route", () => {
    renderWithDirection("v1", undefined);
    expect(screen.getByText("No active route.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the empty state when the route has no edges", () => {
    renderWithDirection("v1", { route: { edges: [], distance: 0 } });
    expect(screen.getByText("No active route.")).toBeInTheDocument();
  });

  it("lists each turn with its road name and the arrival step", () => {
    renderWithDirection("v1", {
      route: {
        edges: [
          edge({ name: "Uhuru Highway", bearing: 90, distance: 1.2 }),
          edge({ name: "Moi Avenue", bearing: 0, distance: 0.3 }),
        ],
        distance: 1.5,
      },
      eta: 300,
    });

    expect(screen.getByText(/Head east on Uhuru Highway/)).toBeInTheDocument();
    expect(screen.getByText("Turn left onto Moi Avenue")).toBeInTheDocument();
    expect(screen.getByText("Arrive at your destination")).toBeInTheDocument();
    // ETA (300 s → 5 min) surfaces in the summary.
    expect(screen.getByText("5 min")).toBeInTheDocument();
  });

  it("marks the step nearest the vehicle position as the current step", () => {
    renderWithDirection(
      "v1",
      {
        route: {
          edges: [
            edge({
              name: "First St",
              bearing: 0,
              distance: 1,
              start: [0, 0],
              end: [0, 2],
            }),
            edge({
              name: "Second St",
              bearing: 90,
              distance: 1,
              start: [0, 10],
              end: [0, 12],
            }),
          ],
          distance: 2,
        },
      },
      [0, 10.5] // nearest Second St's midpoint [0, 11]
    );

    const current = document.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current).toHaveTextContent("Turn right onto Second St");
  });

  it("reports route progress from the vehicle's position along the steps", () => {
    // Three equal 1 km steps; sitting on the second one means one of three
    // steps (33%) is behind us and "Step 2/4" (incl. the arrive pseudo-step).
    const { unmount } = renderWithDirection(
      "v1",
      {
        route: {
          edges: [
            edge({ name: "A St", bearing: 0, distance: 1, start: [0, 0], end: [0, 2] }),
            edge({ name: "B St", bearing: 90, distance: 1, start: [0, 10], end: [0, 12] }),
            edge({ name: "C St", bearing: 0, distance: 1, start: [0, 20], end: [0, 22] }),
          ],
          distance: 3,
        },
      },
      [0, 11] // exactly B St's midpoint
    );

    const bar = screen.getByRole("progressbar", { name: "Route progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("Step 2/4")).toBeInTheDocument();
    unmount();
  });

  it("reports zero progress when the position can't be placed on the route", () => {
    renderWithDirection("v1", {
      route: {
        edges: [edge({ name: "A St", bearing: 0, distance: 1 })],
        distance: 1,
      },
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("pins a step on click and toggles it off on a second click", async () => {
    renderWithDirection("v1", {
      route: {
        edges: [
          edge({ name: "First St", bearing: 0, distance: 1 }),
          edge({ name: "Second St", bearing: 90, distance: 1 }),
        ],
        distance: 2,
      },
    });

    const turn = screen.getByRole("button", {
      name: /Turn right onto Second St/,
    });
    expect(turn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(turn);
    expect(turn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(turn);
    expect(turn).toHaveAttribute("aria-pressed", "false");
  });

  it("makes the terminal arrival step non-interactive", () => {
    renderWithDirection("v1", {
      route: {
        edges: [edge({ name: "Only St", bearing: 0, distance: 1 })],
        distance: 1,
      },
    });
    const arrive = screen.getByRole("button", {
      name: /Arrive at your destination/,
    });
    expect(arrive).toBeDisabled();
  });
});

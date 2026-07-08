import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VehicleDirections from "./VehicleDirections";
import { DirectionContext, type DirectionMap } from "@/data/context";
import type { DirectionState } from "@/hooks/useDirections";
import type { Edge, Node, Position } from "@/types";

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
  it("renders nothing when the vehicle has no active route", () => {
    const { container } = renderWithDirection("v1", undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the route has no edges", () => {
    const { container } = renderWithDirection("v1", { route: { edges: [], distance: 0 } });
    expect(container).toBeEmptyDOMElement();
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
            edge({ name: "First St", bearing: 0, distance: 1, start: [0, 0], end: [0, 2] }),
            edge({ name: "Second St", bearing: 90, distance: 1, start: [0, 10], end: [0, 12] }),
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
});

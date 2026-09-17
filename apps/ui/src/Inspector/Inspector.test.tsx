import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector, { inspectorTitle } from "./Inspector";
import { createVehicle, createVehicleDTO, createPOI } from "@/test/mocks/types";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { vehicleEventStore } from "./vehicleEventStore";
import { TELEMETRY_SAMPLE_MS } from "./telemetry";
import { getInsets } from "@/components/Map/mapInsets";

beforeEach(() => vehicleEventStore.clear());

/**
 * The inspector is a console section now (see `shell/Console`), not a floating
 * aside at the map's right edge. It has no frame, no header and no close
 * button of its own — the console owns all three — and it no longer reports a
 * band to `mapInsets`, because a docked surface covers no map to aim around.
 */
describe("what the inspector no longer owns", () => {
  it("claims no band of the map", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} />);
    expect(getInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("brings no frame or placement of its own", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} />);
    const panel = screen.getByRole("region", { name: "Inspector" });
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("border");
    expect(panel.className).not.toContain("shadow");
  });

  it("titles itself after what is selected, for the console's header", () => {
    expect(inspectorTitle(createVehicle({ name: "Van 12" }))).toBe("Van 12");
    expect(inspectorTitle(undefined, createPOI({ name: "Depot" }))).toBe("Depot");
    expect(inspectorTitle(undefined, createPOI({ name: null }))).toBe("Point of interest");
    // The section's own label is the fallback, and only for an empty selection.
    expect(inspectorTitle()).toBe("Inspect");
  });
});

describe("Inspector", () => {
  it("stays mounted but renders nothing when the selection is cleared", () => {
    // The one section allowed to render empty. A surface that vanished out from
    // under the operator when they cleared a selection would read as a bug, and
    // the console has no other view to fall back to — but empty means empty.
    // The console's header already says "Inspect" with nothing after it.
    render(<Inspector />);
    const panel = screen.getByRole("region", { name: "Inspector" });
    expect(panel).toBeEmptyDOMElement();
  });

  it("renders vehicle details when a vehicle is selected", () => {
    render(
      <Inspector
        vehicle={createVehicle({
          id: "v1",
          name: "Test Vehicle 1",
          speed: 42,
          heading: 90,
        })}
      />
    );
    // The name is the console header's now (see `inspectorTitle`); the view
    // itself is the detail under it.
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText(/42 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/90°/)).toBeInTheDocument();
    expect(screen.getByText("En route")).toBeInTheDocument();
  });

  it("shows Idle status for a stopped vehicle", () => {
    render(<Inspector vehicle={createVehicle({ speed: 0 })} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("prefers the resolved fleet name over the raw fleet id", () => {
    const fleet: Fleet = {
      id: "f1",
      name: "North Fleet",
      color: "#fff",
      source: "local",
      vehicleIds: ["v1"],
    };
    render(<Inspector vehicle={createVehicle({ id: "v1" })} fleet={fleet} />);
    expect(screen.getByText("North Fleet")).toBeInTheDocument();
  });

  it("renders POI details, falling back gracefully when the name is null", () => {
    render(<Inspector poi={createPOI({ id: "poi1", name: null, type: "restaurant" })} />);
    expect(screen.getByText("restaurant")).toBeInTheDocument();
    expect(screen.getByText("poi1")).toBeInTheDocument();
  });

  // Escape-to-close is not the inspector's own listener any more: it is the
  // `clear-selection` branch of the app's single keyboard dispatcher, covered
  // by useInteractionMode.test.ts.
  it("does not install its own Escape listener", async () => {
    render(<Inspector vehicle={createVehicle()} />);
    await userEvent.keyboard("{Escape}");
    // Nothing here to fire: closing is the console's, and clearing the
    // selection is the app's one keyboard dispatcher.
    expect(screen.getByRole("region", { name: "Inspector" })).toBeInTheDocument();
  });

  it("renders the ETA, telemetry, directions and events sections for a vehicle", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} />);
    expect(screen.getByText("ETA")).toBeInTheDocument();
    expect(screen.getByText("Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Directions")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    // No route, no telemetry window yet, no events: four honest empty states,
    // each phrased for its own section.
    expect(screen.getByText("Collecting telemetry…")).toBeInTheDocument();
    expect(screen.getByText("No route assigned.")).toBeInTheDocument();
    expect(screen.getByText("No active route.")).toBeInTheDocument();
    expect(screen.getByText("No events recorded for this vehicle.")).toBeInTheDocument();
  });

  it("surfaces captured events for the selected vehicle only", () => {
    vehicleEventStore.record({
      vehicleId: "v1",
      kind: "reroute",
      at: Date.now(),
      label: "Rerouted around incident",
    });
    vehicleEventStore.record({
      vehicleId: "v2",
      kind: "arrival",
      at: Date.now(),
      label: "Route completed",
    });
    render(<Inspector vehicle={createVehicle({ id: "v1" })} />);
    expect(screen.getByText("Rerouted around incident")).toBeInTheDocument();
    expect(screen.queryByText("Route completed")).not.toBeInTheDocument();
  });

  it("shows only the POI section for a POI selection", () => {
    render(<Inspector poi={createPOI()} />);
    expect(screen.queryByText("Telemetry")).not.toBeInTheDocument();
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
  });
});

describe("Inspector hot-path isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vehicleStore.replace([createVehicleDTO({ id: "v1", speed: 30 })]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vehicleStore.replace([]);
  });

  it("does not re-render on vehicle position ticks, and samples at 1 Hz", () => {
    const onRender = vi.fn();
    render(
      <Profiler id="inspector" onRender={onRender}>
        <Inspector vehicle={createVehicle({ id: "v1" })} />
      </Profiler>
    );

    // Let the mount-time commits settle (mount + first telemetry sample).
    const afterMount = onRender.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    // 300 position ticks — roughly ten seconds of simulator traffic — with the
    // store notifying on every one. The inspector reads the store, it never
    // subscribes to it, so React must stay completely idle.
    act(() => {
      for (let i = 0; i < 300; i++) {
        vehicleStore.enqueue(createVehicleDTO({ id: "v1", speed: 30 + (i % 20) }));
        vehicleStore.notify();
      }
    });
    expect(onRender.mock.calls.length).toBe(afterMount);

    // One sampling tick = exactly one commit, no matter how many ticks landed.
    act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
    expect(onRender.mock.calls.length).toBe(afterMount + 1);

    // …and it stays one commit per second thereafter.
    for (let i = 2; i <= 4; i++) {
      act(() => vi.advanceTimersByTime(TELEMETRY_SAMPLE_MS));
      expect(onRender.mock.calls.length).toBe(afterMount + i);
    }
  });
});

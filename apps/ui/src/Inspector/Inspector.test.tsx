import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector from "./Inspector";
import { createVehicle, createVehicleDTO, createPOI } from "@/test/mocks/types";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { vehicleEventStore } from "./vehicleEventStore";
import { TELEMETRY_SAMPLE_MS } from "./telemetry";

beforeEach(() => vehicleEventStore.clear());

describe("Inspector", () => {
  it("renders nothing when neither a vehicle nor a POI is selected", () => {
    const { container } = render(<Inspector onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
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
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Test Vehicle 1")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText(/42 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/90°/)).toBeInTheDocument();
    expect(screen.getByText("En route")).toBeInTheDocument();
  });

  it("shows Idle status for a stopped vehicle", () => {
    render(<Inspector vehicle={createVehicle({ speed: 0 })} onClose={vi.fn()} />);
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
    render(<Inspector vehicle={createVehicle({ id: "v1" })} fleet={fleet} onClose={vi.fn()} />);
    expect(screen.getByText("North Fleet")).toBeInTheDocument();
  });

  it("renders POI details, falling back gracefully when the name is null", () => {
    render(
      <Inspector
        poi={createPOI({ id: "poi1", name: null, type: "restaurant" })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Point of interest")).toBeInTheDocument();
    expect(screen.getByText("restaurant")).toBeInTheDocument();
    expect(screen.getByText("poi1")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<Inspector vehicle={createVehicle()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Escape-to-close is not the inspector's own listener any more: it is the
  // `clear-selection` branch of the app's single keyboard dispatcher, covered
  // by useInteractionMode.test.ts.
  it("does not install its own Escape listener", async () => {
    const onClose = vi.fn();
    render(<Inspector vehicle={createVehicle()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the telemetry, directions and events sections for a vehicle", () => {
    render(<Inspector vehicle={createVehicle({ id: "v1" })} onClose={vi.fn()} />);
    expect(screen.getByText("Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Directions")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    // No route, no telemetry window yet, no events: three honest empty states.
    expect(screen.getByText("Collecting telemetry…")).toBeInTheDocument();
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
    render(<Inspector vehicle={createVehicle({ id: "v1" })} onClose={vi.fn()} />);
    expect(screen.getByText("Rerouted around incident")).toBeInTheDocument();
    expect(screen.queryByText("Route completed")).not.toBeInTheDocument();
  });

  it("shows only the POI section for a POI selection", () => {
    render(<Inspector poi={createPOI()} onClose={vi.fn()} />);
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
        <Inspector vehicle={createVehicle({ id: "v1" })} onClose={vi.fn()} />
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

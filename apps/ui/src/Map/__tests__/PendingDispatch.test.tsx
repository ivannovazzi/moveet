import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DispatchAssignment, Vehicle, Position } from "@/types";
import { createVehicle } from "@/test/mocks/types";

// ---------------------------------------------------------------------------
// Capture registered layers via useRegisterLayers mock
// ---------------------------------------------------------------------------
const { registeredLayers } = vi.hoisted(() => {
  const registeredLayers = new Map<string, unknown[]>();
  return { registeredLayers };
});

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
  useDeckLayersContext: () => ({
    registerLayers: () => {},
    unregisterLayers: () => {},
  }),
}));

import PendingDispatch from "../PendingDispatch";

function makeAssignment(overrides: Partial<DispatchAssignment> = {}): DispatchAssignment {
  return {
    vehicleId: "v1",
    vehicleName: "Truck Alpha",
    waypoints: [{ position: [-1.2921, 36.8219] }],
    ...overrides,
  };
}

/** Get all registered layers for pending-dispatch. */
function getLayers(): unknown[] {
  return registeredLayers.get("pending-dispatch") ?? [];
}

/** Get a layer by its id. */
function getLayer(id: string): { props: Record<string, unknown> } | undefined {
  const layers = getLayers();
  return layers.find((l) => (l as { props: { id: string } }).props.id === id) as
    | { props: Record<string, unknown> }
    | undefined;
}

describe("PendingDispatch", () => {
  const defaultVehicles: Vehicle[] = [
    createVehicle({ id: "v1", name: "Truck Alpha", position: [36.8219, -1.2921] as Position }),
    createVehicle({ id: "v2", name: "Van Beta", position: [36.85, -1.3] as Position }),
  ];

  beforeEach(() => {
    registeredLayers.clear();
  });

  it("returns null and registers empty layers with empty assignments", () => {
    const { container } = render(<PendingDispatch assignments={[]} vehicles={defaultVehicles} />);

    // Component returns null
    expect(container.innerHTML).toBe("");

    // No layers registered (empty array)
    const layers = getLayers();
    expect(layers.length).toBe(0);
  });

  it("renders deck.gl layers for assignments", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    const layers = getLayers();
    // Single waypoint creates: outer ring + inner dot + labels = 3 layers
    expect(layers.length).toBeGreaterThanOrEqual(2);

    // Check for single-waypoint outer ring layer
    const outerRing = getLayer("pending-dispatch-single-outer");
    expect(outerRing).toBeTruthy();
    expect((outerRing!.props.data as unknown[]).length).toBe(1);

    // Check for single-waypoint labels
    const labels = getLayer("pending-dispatch-single-labels");
    expect(labels).toBeTruthy();
  });

  it("renders correct number of markers for multiple assignments", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
      makeAssignment({
        vehicleId: "v2",
        vehicleName: "Van Beta",
        waypoints: [{ position: [-1.3, 36.85] }],
      }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    // Both are single-waypoint: outer ring has 2 items, inner dot has 2
    const outerRing = getLayer("pending-dispatch-single-outer");
    expect(outerRing).toBeTruthy();
    expect((outerRing!.props.data as unknown[]).length).toBe(2);

    const innerDot = getLayer("pending-dispatch-single-inner");
    expect(innerDot).toBeTruthy();
    expect((innerDot!.props.data as unknown[]).length).toBe(2);
  });

  it("skips assignments whose vehicle is not found in the vehicles list", () => {
    const assignments = [
      makeAssignment({ vehicleId: "nonexistent", vehicleName: "Ghost Vehicle" }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    // No layers should have data (vehicle not found)
    const layers = getLayers();
    expect(layers.length).toBe(0);
  });

  it("renders numbered markers for multi-waypoint assignments", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [
          { position: [-1.29, 36.82] },
          { position: [-1.3, 36.83] },
          { position: [-1.31, 36.84] },
        ],
      }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    // Multi-waypoint creates: lines + circle markers + number text + vehicle name label
    const markers = getLayer("pending-dispatch-multi-markers");
    expect(markers).toBeTruthy();
    expect((markers!.props.data as unknown[]).length).toBe(3);

    const numbers = getLayer("pending-dispatch-multi-numbers");
    expect(numbers).toBeTruthy();
    expect((numbers!.props.data as unknown[]).length).toBe(3);
  });

  it("renders connecting lines between waypoints", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [
          { position: [-1.29, 36.82] },
          { position: [-1.3, 36.83] },
          { position: [-1.31, 36.84] },
        ],
      }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    // 3 waypoints → 2 connecting lines
    const lines = getLayer("pending-dispatch-multi-lines");
    expect(lines).toBeTruthy();
    expect((lines!.props.data as unknown[]).length).toBe(2);
  });

  it("renders single-waypoint assignment with outer ring and inner dot", () => {
    const assignments = [
      makeAssignment({
        vehicleId: "v1",
        vehicleName: "Truck Alpha",
        waypoints: [{ position: [-1.2921, 36.8219] }],
      }),
    ];

    render(<PendingDispatch assignments={assignments} vehicles={defaultVehicles} />);

    // Outer ring: transparent fill
    const outerRing = getLayer("pending-dispatch-single-outer");
    expect(outerRing).toBeTruthy();
    expect(outerRing!.props.getFillColor).toEqual([0, 0, 0, 0]);

    // Inner dot
    const innerDot = getLayer("pending-dispatch-single-inner");
    expect(innerDot).toBeTruthy();

    // No connecting lines for single waypoint
    const lines = getLayer("pending-dispatch-multi-lines");
    expect(lines).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";

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

// Import AFTER mocks
import VehiclesLayer from "@/Map/Vehicle/VehiclesLayer";
import { DeckMapContext } from "@/components/Map/providers/contexts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeFleetMap(...entries: Array<[string, Partial<Fleet>]>): Map<string, Fleet> {
  const map = new Map<string, Fleet>();
  for (const [vehicleId, partial] of entries) {
    map.set(vehicleId, {
      id: partial.id ?? "fleet-1",
      name: partial.name ?? "Fleet 1",
      color: partial.color ?? "#ff0000",
      source: partial.source ?? "local",
      vehicleIds: partial.vehicleIds ?? [vehicleId],
    });
  }
  return map;
}

const defaultProps = {
  scale: 1.5,
  vehicleFleetMap: new Map<string, Fleet>(),
  hiddenFleetIds: new Set<string>(),
  hiddenVehicleTypes: new Set<string>(),
  onClick: vi.fn(),
};

/**
 * Render VehiclesLayer then run one animation frame to trigger the render loop.
 */
function renderAndTick(props: Partial<typeof defaultProps> = {}) {
  const merged = { ...defaultProps, ...props };
  const result = render(<VehiclesLayer {...merged} />);

  // Run pending effects and advance past the STATE_UPDATE_INTERVAL (16ms) throttle
  act(() => {
    vi.advanceTimersByTime(0);
  });
  act(() => {
    vi.advanceTimersByTime(50); // exceed 16ms throttle → setState fires
  });

  return result;
}

/** Extract the vehicles IconLayer data from registered layers. */
function getVehiclesLayerData(): Array<{
  id: string;
  position: [number, number];
  angle: number;
  icon: string;
  isSelected: boolean;
  isHovered: boolean;
}> {
  const layers = registeredLayers.get("vehicles") ?? [];
  // The vehicles layer has id="vehicles" — it's always the second in the array
  // [ringLayer, vehiclesLayer]
  const vehiclesLayer = layers.find(
    (l) => (l as { props: { id: string } }).props.id === "vehicles"
  ) as { props: { data: ReturnType<typeof getVehiclesLayerData> } } | undefined;
  return vehiclesLayer?.props.data ?? [];
}

/** Extract the selection/hover highlight ring layer data. */
function getSelectionRingData(): unknown[] {
  const layers = registeredLayers.get("vehicles") ?? [];
  const selectionLayer = layers.find(
    (l) => (l as { props: { id: string } }).props.id === "vehicle-highlight-ring"
  ) as { props: { data: unknown[] } } | undefined;
  return selectionLayer?.props.data ?? [];
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  vehicleStore.replace([]);
  defaultProps.onClick.mockClear();
  registeredLayers.clear();

  // Stub requestAnimationFrame/cancelAnimationFrame with timer-based versions
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    return setTimeout(cb, 16) as unknown as number;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    clearTimeout(id);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("VehiclesLayer (deck.gl)", () => {
  it("returns null (renders no DOM elements)", () => {
    const { container } = render(<VehiclesLayer {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("registers layers with id 'vehicles'", () => {
    renderAndTick();
    expect(registeredLayers.has("vehicles")).toBe(true);
  });

  it("registers two layers: highlight ring and vehicles", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick();

    const layers = registeredLayers.get("vehicles")!;
    expect(layers.length).toBe(2);

    const ids = layers.map((l) => (l as { props: { id: string } }).props.id);
    expect(ids).toContain("vehicles");
    expect(ids).toContain("vehicle-highlight-ring");
  });

  it("produces interpolated data for each vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
      { id: "v2", name: "V2", position: [36.83, -1.3], speed: 40, heading: 180 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    expect(data.length).toBe(2);
    expect(data.map((d) => d.id).sort()).toEqual(["v1", "v2"]);
  });

  it("applies fleet colors via the sprite atlas key", () => {
    const fleetMap = makeFleetMap(["v1", { color: "#ff0000" }], ["v2", { color: "#00ff00" }]);

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
      { id: "v2", name: "V2", position: [36.83, -1.3], speed: 40, heading: 0 },
    ]);

    renderAndTick({ vehicleFleetMap: fleetMap });

    const data = getVehiclesLayerData();
    const v1 = data.find((d) => d.id === "v1")!;
    const v2 = data.find((d) => d.id === "v2")!;

    // Atlas keys encode the (type, color) sprite cell
    expect(v1.icon).toBe("car|#ff0000");
    expect(v2.icon).toBe("car|#00ff00");
  });

  it("uses the default type color when vehicle has no fleet", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    // DEFAULT_FILL "#dcdcdc" for type "car"
    expect(data[0].icon).toBe("car|#dcdcdc");
  });

  it("skips vehicles at origin (0, 0)", () => {
    vehicleStore.replace([{ id: "v1", name: "V1", position: [0, 0], speed: 30, heading: 90 }]);

    renderAndTick();

    const data = getVehiclesLayerData();
    expect(data.length).toBe(0);
  });

  it("skips vehicles in hidden fleets", () => {
    const fleetMap = makeFleetMap(["v1", { id: "fleet-1", color: "#ff0000" }]);
    const hiddenFleetIds = new Set(["fleet-1"]);

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick({ vehicleFleetMap: fleetMap, hiddenFleetIds });

    const data = getVehiclesLayerData();
    expect(data.length).toBe(0);
  });

  it("skips vehicles of hidden types", () => {
    vehicleStore.replace([
      { id: "v1", name: "Car-1", type: "car", position: [36.82, -1.29], speed: 30, heading: 90 },
      {
        id: "v2",
        name: "Truck-1",
        type: "truck",
        position: [36.83, -1.28],
        speed: 25,
        heading: 45,
      },
    ]);

    renderAndTick({ hiddenVehicleTypes: new Set(["truck"]) });

    const data = getVehiclesLayerData();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("v1");
  });

  it("marks selected vehicle in interpolated data", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ selectedId: "v1" });

    const data = getVehiclesLayerData();
    expect(data[0].isSelected).toBe(true);
  });

  it("marks hovered vehicle in interpolated data", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ hoveredId: "v1" });

    const data = getVehiclesLayerData();
    expect(data[0].isHovered).toBe(true);
  });

  it("populates selection ring data for selected vehicle", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick({ selectedId: "v1" });

    const ringData = getSelectionRingData();
    expect(ringData.length).toBe(1);
  });

  it("does not populate selection ring data when no vehicle is selected", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const ringData = getSelectionRingData();
    expect(ringData.length).toBe(0);
  });

  it("does not produce data when no vehicles are in the store", () => {
    vehicleStore.replace([]);
    renderAndTick();

    const data = getVehiclesLayerData();
    expect(data.length).toBe(0);
  });

  it("converts position from [lat, lng] to [lng, lat] for deck.gl", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    // position[0] = lng, position[1] = lat
    // Original: [36.82 (lat), -1.29 (lng)] → deck.gl: [-1.29 (lng), 36.82 (lat)]
    expect(data[0].position[0]).toBeCloseTo(-1.29, 1);
    expect(data[0].position[1]).toBeCloseTo(36.82, 1);
  });

  it("converts compass heading (CW) to deck.gl angle (CCW degrees)", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    expect(data[0].angle).toBeCloseTo(-90, 5);
  });
});

describe("VehiclesLayer teleport detection", () => {
  /**
   * After isNew has cleared, a small continuous-motion update should interpolate
   * between the previous and new position (not snap).
   */
  it("interpolates small, plausible position changes", () => {
    // Spawn
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);
    renderAndTick();

    // First movement — clears isNew by snapping. Vehicle now at B.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.8205, -1.29], speed: 30, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Second small movement (~5m, plausible at 30 km/h) → should animate.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.8206, -1.29], speed: 30, heading: 0 },
    ]);
    // Tick briefly — should be mid-interpolation between 36.8205 and 36.8206.
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const data = getVehiclesLayerData();
    // position[1] is lat. Should be between prev and next (interpolation in progress).
    expect(data[0].position[1]).toBeGreaterThanOrEqual(36.8205);
    expect(data[0].position[1]).toBeLessThanOrEqual(36.8206);
  });

  /**
   * A position jump far exceeding `speed × elapsed` is a teleport
   * (dispatch reposition, bulk reset, WS reconnect). Render should snap
   * to the destination — not interpolate from the previous position.
   */
  it("snaps on large position jumps (teleport)", () => {
    // Spawn
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);
    renderAndTick();

    // First real move — clears isNew via the existing snap.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.821, -1.29], speed: 30, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Teleport ~1° of latitude away (~111 km) — far beyond any plausible
    // motion at 30 km/h over 100 ms.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [37.821, -1.29], speed: 30, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const data = getVehiclesLayerData();
    // Should render at the destination, not somewhere between 36.821 and 37.821.
    expect(data[0].position[1]).toBeCloseTo(37.821, 2);
  });

  /**
   * A stopped vehicle (speed=0) shouldn't be classified as teleporting when it
   * receives a small real-world reposition (e.g. 20 m dispatch nudge). The floor
   * allows small moves to still animate normally.
   */
  it("treats small moves as continuous even at speed=0 (floor)", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 0, heading: 0 },
    ]);
    renderAndTick();

    // Move ~11 m (under the 50 m floor). isNew clears here via existing snap.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.8201, -1.29], speed: 0, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Another ~11 m move — should animate (not teleport-snap).
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.8202, -1.29], speed: 0, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const data = getVehiclesLayerData();
    expect(data[0].position[1]).toBeGreaterThanOrEqual(36.8201);
    expect(data[0].position[1]).toBeLessThanOrEqual(36.8202);
  });

  /**
   * Bulk replace (as used by onReset / reconnect resync) must not animate surviving
   * vehicles across large distances — the heuristic catches this without needing
   * an explicit lifecycle signal.
   */
  it("snaps surviving vehicles on bulk replace with large deltas", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);
    renderAndTick();

    // Normal progression to clear isNew.
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.821, -1.29], speed: 30, heading: 0 },
    ]);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Simulated reset / reconnect: same vehicle ID reappears far away.
    vehicleStore.replace([{ id: "v1", name: "V1", position: [36.9, -1.4], speed: 30, heading: 0 }]);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    const data = getVehiclesLayerData();
    expect(data[0].position[1]).toBeCloseTo(36.9, 2);
    expect(data[0].position[0]).toBeCloseTo(-1.4, 2);
  });
});

describe("VehiclesLayer viewport culling", () => {
  /** Render inside a map context whose viewport covers central Nairobi. */
  function renderWithViewport(props: Partial<typeof defaultProps> & { selectedId?: string } = {}) {
    const merged = { ...defaultProps, ...props };
    const result = render(
      <DeckMapContext.Provider
        value={{
          viewport: null,
          viewState: null,
          getZoom: () => 12,
          project: () => null,
          // [[west, south], [east, north]]
          getBoundingBox: () => [
            [36.7, -1.4],
            [36.9, -1.2],
          ],
        }}
      >
        <VehiclesLayer {...merged} />
      </DeckMapContext.Provider>
    );

    act(() => {
      vi.advanceTimersByTime(0);
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    return result;
  }

  it("culls vehicles far outside the viewport", () => {
    vehicleStore.replace([
      { id: "inside", name: "In", position: [-1.29, 36.82], speed: 30, heading: 0 },
      { id: "outside", name: "Out", position: [10, 50], speed: 30, heading: 0 },
    ]);

    renderWithViewport();

    const data = getVehiclesLayerData();
    expect(data.map((d) => d.id)).toEqual(["inside"]);
  });

  it("keeps vehicles just outside the viewport (margin)", () => {
    vehicleStore.replace([
      // ~0.03° east of the east edge — inside the 25% (0.05°) margin
      { id: "near-edge", name: "Edge", position: [-1.3, 36.93], speed: 30, heading: 0 },
    ]);

    renderWithViewport();

    const data = getVehiclesLayerData();
    expect(data.map((d) => d.id)).toEqual(["near-edge"]);
  });

  it("never culls the selected vehicle", () => {
    vehicleStore.replace([
      { id: "outside", name: "Out", position: [10, 50], speed: 30, heading: 0 },
    ]);

    renderWithViewport({ selectedId: "outside" });

    const data = getVehiclesLayerData();
    expect(data.map((d) => d.id)).toEqual(["outside"]);
  });

  it("does not cull when no viewport bounds are available (default context)", () => {
    vehicleStore.replace([
      { id: "anywhere", name: "Far", position: [10, 50], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    expect(data.map((d) => d.id)).toEqual(["anywhere"]);
  });
});

describe("VehiclesLayer hit testing (deck.gl)", () => {
  it("vehicles layer is pickable for click handling", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const layers = registeredLayers.get("vehicles")!;
    const vehiclesLayer = layers.find(
      (l) => (l as { props: { id: string } }).props.id === "vehicles"
    ) as { props: { pickable: boolean; onClick: (info: { object?: unknown }) => void } };

    expect(vehiclesLayer.props.pickable).toBe(true);
    expect(typeof vehiclesLayer.props.onClick).toBe("function");
  });
});

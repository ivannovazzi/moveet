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
  onClick: vi.fn(),
};

/**
 * Render VehiclesLayer then run one animation frame to trigger the render loop.
 */
function renderAndTick(props: Partial<typeof defaultProps> = {}) {
  const merged = { ...defaultProps, ...props };
  const result = render(<VehiclesLayer {...merged} />);

  // Run pending effects and one animation frame
  act(() => {
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(16); // one frame ~16ms
  });

  return result;
}

/** Extract the vehicles ScatterplotLayer data from registered layers. */
function getVehiclesLayerData(): Array<{
  id: string;
  position: [number, number];
  heading: number;
  color: [number, number, number, number];
  type: string;
  isSelected: boolean;
  isHovered: boolean;
}> {
  const layers = registeredLayers.get("vehicles") ?? [];
  // The vehicles layer has id="vehicles" — it's always the second in the array
  // [selectionRingLayer, vehiclesLayer]
  const vehiclesLayer = layers.find(
    (l) => (l as { props: { id: string } }).props.id === "vehicles"
  ) as { props: { data: ReturnType<typeof getVehiclesLayerData> } } | undefined;
  return vehiclesLayer?.props.data ?? [];
}

/** Extract the selection ring layer data. */
function getSelectionRingData(): unknown[] {
  const layers = registeredLayers.get("vehicles") ?? [];
  const selectionLayer = layers.find(
    (l) => (l as { props: { id: string } }).props.id === "vehicle-selection-ring"
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

  it("registers two layers: selection ring and vehicles", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 90 },
    ]);

    renderAndTick();

    const layers = registeredLayers.get("vehicles")!;
    expect(layers.length).toBe(2);

    const ids = layers.map((l) => (l as { props: { id: string } }).props.id);
    expect(ids).toContain("vehicles");
    expect(ids).toContain("vehicle-selection-ring");
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

  it("applies fleet colors for vehicle fill", () => {
    const fleetMap = makeFleetMap(["v1", { color: "#ff0000" }], ["v2", { color: "#00ff00" }]);

    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
      { id: "v2", name: "V2", position: [36.83, -1.3], speed: 40, heading: 0 },
    ]);

    renderAndTick({ vehicleFleetMap: fleetMap });

    const data = getVehiclesLayerData();
    const v1 = data.find((d) => d.id === "v1")!;
    const v2 = data.find((d) => d.id === "v2")!;

    // #ff0000 → [255, 0, 0, 255]
    expect(v1.color).toEqual([255, 0, 0, 255]);
    // #00ff00 → [0, 255, 0, 255]
    expect(v2.color).toEqual([0, 255, 0, 255]);
  });

  it("uses default fill color when vehicle has no fleet", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    renderAndTick();

    const data = getVehiclesLayerData();
    // DEFAULT_FILL "#dcdcdc" → [220, 220, 220, 255]
    expect(data[0].color).toEqual([220, 220, 220, 255]);
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { VehicleDTO } from "@moveet/shared-types";
import type { Fleet, VehicleType } from "@/types";

// ── Capture registered layers by id ────────────────────────────────
const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

// ── Mock viewport (zoom is the switch input) ───────────────────────
const { ctx } = vi.hoisted(() => ({ ctx: { zoom: 11 } }));
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({ viewState: { zoom: ctx.zoom } }),
}));

// ── Mock the vehicle store ─────────────────────────────────────────
const { store } = vi.hoisted(() => ({ store: new Map<string, VehicleDTO>() }));
vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: { getAll: () => store },
}));

import VehicleDensityLayer, { DENSITY_LAYER_ID } from "./VehicleDensityLayer";
import { DENSITY_MIN_VEHICLES, DENSITY_ZOOM_THRESHOLD, densityColorRange } from "./densityView";

// ── Helpers ────────────────────────────────────────────────────────

function seedVehicles(count: number, type: VehicleType = "car") {
  store.clear();
  for (let i = 0; i < count; i++) {
    store.set(`v${i}`, {
      id: `v${i}`,
      name: `V${i}`,
      type,
      // [lat, lng] in store order — spread over a small Nairobi-ish box.
      position: [-1.28 + (i % 20) * 0.001, 36.82 + Math.floor(i / 20) * 0.001],
      speed: 30,
      heading: 90,
    } as unknown as VehicleDTO);
  }
}

interface Overrides {
  vehicleFleetMap?: Map<string, Fleet>;
  hiddenFleetIds?: Set<string>;
  hiddenVehicleTypes?: Set<VehicleType>;
}

function renderLayer(overrides: Overrides = {}) {
  return render(
    <VehicleDensityLayer
      vehicleFleetMap={overrides.vehicleFleetMap ?? new Map()}
      hiddenFleetIds={overrides.hiddenFleetIds ?? new Set()}
      hiddenVehicleTypes={overrides.hiddenVehicleTypes ?? new Set()}
    />
  );
}

type LayerLike = { id: string; props: Record<string, unknown> };

function densityLayer(): LayerLike | undefined {
  return registeredLayers.get(DENSITY_LAYER_ID)?.[0] as LayerLike | undefined;
}

function densityPoints(): [number, number][] {
  return (densityLayer()?.props.data ?? []) as [number, number][];
}

beforeEach(() => {
  registeredLayers.clear();
  store.clear();
  ctx.zoom = 11;
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("VehicleDensityLayer", () => {
  it("constructs a HexagonLayer with the expected aggregation props", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    renderLayer();

    const layer = densityLayer();
    expect(layer).toBeDefined();
    expect(layer?.id).toBe(DENSITY_LAYER_ID);
    expect(layer?.constructor.name).toBe("HexagonLayer");

    const props = layer?.props as Record<string, unknown>;
    expect(props.colorAggregation).toBe("SUM");
    expect(props.colorScaleType).toBe("quantize");
    expect(props.getColorWeight).toBe(1);
    expect(props.extruded).toBe(false);
    expect(props.coverage).toBe(0.92);
    expect(props.pickable).toBe(false);
    // Bin size is a real, zoom-derived metre radius.
    expect(props.radius).toBeGreaterThan(0);
    expect(props.radius).toBeLessThanOrEqual(20000);
    // Colour comes from the token-derived sequential ramp, not a rainbow.
    expect(props.colorRange).toEqual(densityColorRange());
  });

  it("feeds every visible vehicle in as a [lng, lat] point", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    const data = densityPoints();
    expect(data).toHaveLength(DENSITY_MIN_VEHICLES);
    // Store holds [lat, lng]; deck.gl needs [lng, lat].
    expect(data[0][0]).toBeCloseTo(36.82, 5);
    expect(data[0][1]).toBeCloseTo(-1.28, 5);
  });

  it("registers no layer when zoomed in past the threshold", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 500);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD + 2;
    renderLayer();

    expect(registeredLayers.get(DENSITY_LAYER_ID)).toEqual([]);
  });

  it("registers no layer below the vehicle-count threshold", () => {
    seedVehicles(DENSITY_MIN_VEHICLES - 1);
    renderLayer();

    expect(registeredLayers.get(DENSITY_LAYER_ID)).toEqual([]);
  });

  it("switches on exactly at the count boundary", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();
    expect(densityLayer()).toBeDefined();
  });

  it("does not switch on exactly at the zoom boundary", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 500);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD;
    renderLayer();
    expect(registeredLayers.get(DENSITY_LAYER_ID)).toEqual([]);
  });

  it("excludes vehicles hidden by the fleet and type filters", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 10);
    // Hide the first 5 vehicles via a hidden fleet.
    const fleet: Fleet = { id: "f1", name: "Hidden", color: "#fff" } as unknown as Fleet;
    const vehicleFleetMap = new Map<string, Fleet>();
    for (let i = 0; i < 5; i++) vehicleFleetMap.set(`v${i}`, fleet);

    renderLayer({ vehicleFleetMap, hiddenFleetIds: new Set(["f1"]) });

    const data = densityPoints();
    expect(data).toHaveLength(DENSITY_MIN_VEHICLES + 10 - 5);
  });

  it("hides everything when the vehicle type is filtered out, but still counts for the switch", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 10, "truck");
    renderLayer({ hiddenVehicleTypes: new Set<VehicleType>(["truck"]) });

    // All points filtered out → nothing to draw.
    expect(registeredLayers.get(DENSITY_LAYER_ID)).toEqual([]);
  });

  it("re-samples the store on an interval", () => {
    vi.useFakeTimers();
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();
    expect(densityPoints().length).toBe(DENSITY_MIN_VEHICLES);

    seedVehicles(DENSITY_MIN_VEHICLES + 40);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(densityPoints().length).toBe(DENSITY_MIN_VEHICLES + 40);
  });

  it("stops sampling after unmount", () => {
    vi.useFakeTimers();
    seedVehicles(DENSITY_MIN_VEHICLES);
    const { unmount } = renderLayer();
    const before = densityPoints().length;

    unmount();
    seedVehicles(DENSITY_MIN_VEHICLES + 40);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(densityPoints().length).toBe(before);
  });
});

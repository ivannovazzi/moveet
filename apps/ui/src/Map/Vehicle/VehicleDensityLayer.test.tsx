import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

  it("hands the legend the very same colour array it hands the layer", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    const ramp = densityLayer()?.props.colorRange as unknown[];
    expect(ramp).toBe(densityColorRange()); // identity, not just equality
    expect(screen.getAllByTestId("density-legend-step")).toHaveLength(ramp.length);
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

// ── Legend ─────────────────────────────────────────────────────────

/** Push a domain through the exact callback deck.gl would call. */
function reportDomain(min: number, max: number) {
  const onSetColorDomain = densityLayer()?.props.onSetColorDomain as (d: [number, number]) => void;
  act(() => {
    onSetColorDomain([min, max]);
  });
}

describe("VehicleDensityLayer legend", () => {
  it("is absent when zoomed in past the density threshold", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 500);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD + 2;
    renderLayer();

    expect(screen.queryByTestId("density-legend")).toBeNull();
  });

  it("is absent below the vehicle-count threshold", () => {
    seedVehicles(DENSITY_MIN_VEHICLES - 1);
    renderLayer();

    expect(screen.queryByTestId("density-legend")).toBeNull();
  });

  it("is absent when the filters leave no vehicles to bin", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 10, "truck");
    renderLayer({ hiddenVehicleTypes: new Set<VehicleType>(["truck"]) });

    expect(screen.queryByTestId("density-legend")).toBeNull();
  });

  it("appears with the plate and names what the colour means", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    const legend = screen.getByTestId("density-legend");
    expect(legend).toHaveAttribute("aria-label", "Vehicles per bin");
    // Bin size is stated so a colour can be read as a density, not a raw count
    // over an unknown area.
    expect(legend.textContent).toMatch(/hex bins/);
  });

  it("renders exactly as many steps as the ramp the layer was given", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    expect(screen.getAllByTestId("density-legend-step")).toHaveLength(densityColorRange().length);
  });

  it("shows no numbers until deck.gl reports a domain", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    expect(screen.getByTestId("density-legend-min")).toHaveTextContent("—");
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("—");
  });

  it("labels the domain deck.gl actually coloured against", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    reportDomain(2, 74);

    expect(screen.getByTestId("density-legend-min")).toHaveTextContent("2");
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("74");
  });

  it("maps each ramp step to the bin range that step colours", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    reportDomain(0, 60); // 6 steps → width 10

    const rows = screen.getByTestId("density-legend-table").querySelectorAll("li");
    expect(rows).toHaveLength(densityColorRange().length);
    expect(rows[0].textContent).toBe("Step 1 of 6: 0 to 10");
    expect(rows[2].textContent).toBe("Step 3 of 6: 20 to 30");
    expect(rows[5].textContent).toBe("Step 6 of 6: 50 to 60");
  });

  it("follows the domain when the data moves under it", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    reportDomain(1, 20);
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("20");

    reportDomain(1, 340);
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("340");
  });

  it("ignores the empty-aggregation domain instead of printing Infinity", () => {
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();

    reportDomain(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);

    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("—");
  });

  it("drops a stale domain when the density view switches off", () => {
    vi.useFakeTimers();
    seedVehicles(DENSITY_MIN_VEHICLES);
    renderLayer();
    reportDomain(1, 99);
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("99");

    // Fleet shrinks below the switch threshold → plate and legend both go.
    seedVehicles(DENSITY_MIN_VEHICLES - 50);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("density-legend")).toBeNull();

    // Back above it: the ramp returns without last time's numbers.
    seedVehicles(DENSITY_MIN_VEHICLES);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("density-legend-max")).toHaveTextContent("—");
  });
});

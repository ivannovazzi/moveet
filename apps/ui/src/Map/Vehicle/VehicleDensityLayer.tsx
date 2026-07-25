import { useEffect, useMemo, useState } from "react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { Layer } from "@deck.gl/core";
import type { Fleet, VehicleType } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { densityColorRange, hexRadiusMetersForZoom, shouldAggregate } from "./densityView";

export const DENSITY_LAYER_ID = "vehicle-density";

/** `[lng, lat]`, deck.gl order. */
type DensityPoint = [number, number];

/**
 * How often the store is re-sampled, in ms.
 *
 * Deliberately *not* the RAF path: hexagon binning is an O(n) pass plus a GPU
 * re-upload, and a density plate over a whole city doesn't visibly change at
 * 60 Hz. 1 Hz matches the cadence React consumers already use for vehicles
 * (see `vehicleStore`'s doc comment) and keeps this layer off the hot path
 * entirely.
 */
const SAMPLE_INTERVAL_MS = 1000;

/** Stable empty array so an inactive memo never re-registers. */
const NO_LAYERS: Layer[] = [];

interface VehicleDensityLayerProps {
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
}

interface Sample {
  points: DensityPoint[];
  /**
   * Unfiltered store size. The switch predicate uses this (not
   * `points.length`) so it matches what `VehiclesLayer`'s RAF loop sees —
   * otherwise a fleet filter could put the two sides of the swap into
   * disagreement and blank the map.
   */
  total: number;
}

const EMPTY_SAMPLE: Sample = { points: [], total: 0 };

/**
 * Zoom-dependent density view for high vehicle counts.
 *
 * Mounted from `Map.tsx` behind the `showDensity` visibility toggle. Once
 * mounted it still only draws when `shouldAggregate()` says individual sprites
 * have stopped being readable — `VehiclesLayer` evaluates the same predicate
 * and suppresses its sprites in the same window, so exactly one of the two
 * representations is on screen at a time.
 */
export default function VehicleDensityLayer({
  vehicleFleetMap,
  hiddenFleetIds,
  hiddenVehicleTypes,
}: VehicleDensityLayerProps) {
  const { viewState } = useMapContext();
  const zoom = viewState?.zoom ?? 0;
  const [sample, setSample] = useState<Sample>(EMPTY_SAMPLE);

  useEffect(() => {
    const read = () => {
      const store = vehicleStore.getAll();
      const points: DensityPoint[] = [];
      for (const v of store.values()) {
        // Same skips as the sprite path: unplaced vehicles and anything the
        // fleet / vehicle-type filters have hidden.
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = vehicleFleetMap.get(v.id);
        if (fleet && hiddenFleetIds.has(fleet.id)) continue;
        if (hiddenVehicleTypes.size > 0 && hiddenVehicleTypes.has((v.type as VehicleType) || "car"))
          continue;
        points.push([v.position[1], v.position[0]]); // store is [lat, lng]
      }
      setSample({ points, total: store.size });
    };

    read();
    const timer = setInterval(read, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [vehicleFleetMap, hiddenFleetIds, hiddenVehicleTypes]);

  const active = shouldAggregate({ enabled: true, zoom, vehicleCount: sample.total });
  // Bucketed to half-zoom steps inside the helper, so this is a stable number
  // across small zoom changes and doesn't bust the memo on every wheel tick.
  const radius = hexRadiusMetersForZoom(zoom);

  const layers = useMemo(() => {
    if (!active || sample.points.length === 0) return NO_LAYERS;
    return [
      new HexagonLayer<DensityPoint>({
        id: DENSITY_LAYER_ID,
        data: sample.points,
        getPosition: (d) => d,
        radius,
        coverage: 0.92,
        // Flat plate — the map has no pitch control, so extrusion would only
        // cost fill rate and occlude neighbouring bins.
        extruded: false,
        // Count per bin: weight 1 per vehicle, summed.
        getColorWeight: 1,
        colorAggregation: "SUM",
        colorScaleType: "quantize",
        colorRange: densityColorRange(),
        pickable: false,
      }),
    ];
  }, [active, sample.points, radius]);

  useRegisterLayers(DENSITY_LAYER_ID, layers);

  return null;
}

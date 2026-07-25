import { useCallback, useEffect, useMemo, useState } from "react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { Layer } from "@deck.gl/core";
import type { Fleet, VehicleType } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { LayersIcon } from "@/components/Icons";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import ScaleLegend from "../ScaleLegend";
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

/** Bin size, phrased for a human reading the legend. */
function formatBinSize(radiusMeters: number): string {
  return radiusMeters >= 1000
    ? `~${(radiusMeters / 1000).toFixed(radiusMeters >= 10000 ? 0 : 1)} km hex bins`
    : `~${radiusMeters} m hex bins`;
}

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
  /**
   * `[min, max]` bin count the layer is currently colouring across.
   *
   * Reported *by deck.gl*, not derived here. With `colorDomain` left unset and
   * no percentile cutoff, `HexagonLayer` colours cells against
   * `aggregator.getResultDomain(0)` and hands that same array to
   * `onSetColorDomain`, so the legend reads the map's own number. Re-deriving
   * it would mean re-implementing hexagon binning, and any drift between the
   * two implementations would be a legend that lies.
   */
  const [colorDomain, setColorDomain] = useState<[number, number] | null>(null);

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
  const drawing = active && sample.points.length > 0;

  // The one ramp. The identical array reference goes to the layer and to the
  // legend below, so "same number of steps, same colours" is structural rather
  // than a convention two call sites have to keep agreeing on.
  const colorRange = densityColorRange();

  const onSetColorDomain = useCallback(([min, max]: [number, number]) => {
    // Aggregation over zero bins yields [Infinity, -Infinity].
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    setColorDomain((prev) => (prev && prev[0] === min && prev[1] === max ? prev : [min, max]));
  }, []);

  // A domain outlives the layer that produced it, so drop it the moment the
  // plate comes off screen; otherwise re-engaging density would flash last
  // time's numbers under this time's colours.
  useEffect(() => {
    if (!drawing) setColorDomain(null);
  }, [drawing]);

  const layers = useMemo(() => {
    if (!drawing) return NO_LAYERS;
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
        colorRange,
        // Deliberately no `colorDomain`: deck.gl derives it from the live bins
        // and reports it back here, which is what the legend renders.
        onSetColorDomain,
        pickable: false,
      }),
    ];
  }, [drawing, sample.points, radius, colorRange, onSetColorDomain]);

  useRegisterLayers(DENSITY_LAYER_ID, layers);

  if (!drawing) return null;

  return (
    <ScaleLegend
      testId="density-legend"
      title="Vehicles per bin"
      subtitle={formatBinSize(radius)}
      icon={LayersIcon}
      colorRange={colorRange}
      domain={colorDomain}
      // Top-left is the only corner nothing else claims: the dock and the
      // start hint own the bottom centre, the type legend the bottom left, the
      // zoom controls and fleet legend the bottom right. Below the search bar
      // rather than beside it, so the two never collide on a narrow window.
      className="left-3 top-[72px]"
    />
  );
}

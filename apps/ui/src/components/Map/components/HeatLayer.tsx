import { useMemo } from "react";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resetMapColorCache, resolveMapColor } from "@/lib/mapColor";
import type { Position } from "@/types";

/** `[r, g, b, a]`, 0-255 — deck.gl's colour array shape. */
export type HeatColor = [number, number, number, number];

/**
 * The heat ramp, in token order.
 *
 * A single warm hue that darkens and saturates, not the old green→red rainbow:
 * the heatmap encodes *how much recent activity*, one magnitude, and a
 * multi-hue ramp reads as categories. The tokens live in `styles/tokens.css`
 * so the ramp is restyled with the rest of the theme rather than here.
 */
const HEAT_RAMP_TOKENS = [
  "var(--color-heat-1)",
  "var(--color-heat-2)",
  "var(--color-heat-3)",
  "var(--color-heat-4)",
  "var(--color-heat-5)",
] as const;

let cachedRamp: HeatColor[] | null = null;

/**
 * Resolved heat ramp, cached so the layer and the legend hold the *same array
 * reference*. Identity matters twice over: deck.gl treats a new `colorRange`
 * as a prop change, and the legend must be structurally incapable of drifting
 * from the map. Cached also because `resolveMapColor` touches
 * `getComputedStyle`, and the theme is dark-only so the tokens never change.
 */
export function heatColorRange(): HeatColor[] {
  cachedRamp ??= HEAT_RAMP_TOKENS.map((token) => resolveMapColor(token));
  return cachedRamp;
}

/**
 * Test seam — drops *both* memos in the path so a restyled token is re-read:
 * the ramp here and `resolveMapColor`'s own per-colour cache underneath it.
 */
export function resetHeatColorRange(): void {
  cachedRamp = null;
  resetMapColorCache();
}

/** Zoom used when the map context hasn't published a view state yet. */
const DEFAULT_ZOOM = 12;

/**
 * Heat blur radius in pixels for a zoom level.
 *
 * A fixed radius is wrong at both ends: 30 px at city zoom smears the whole
 * fleet into one blob, and at street zoom it is a dot per vehicle. The radius
 * therefore grows with zoom — a compromise, not constant ground coverage:
 * true ground coverage would double the pixel radius per zoom level and blow
 * past the screen within a few steps, so this covers under 3x across the five
 * zoom levels that matter and clamps flat outside them.
 *
 * Zoom is bucketed to half-steps first: `HeatmapLayer` re-aggregates when
 * `radiusPixels` changes, and a continuously-varying radius would do that on
 * every wheel tick.
 */
export function heatRadiusForZoom(zoom: number): number {
  const z = Math.round((Number.isFinite(zoom) ? zoom : DEFAULT_ZOOM) * 2) / 2;
  if (z <= 11) return 18;
  if (z <= 14) return 18 + ((z - 11) / 3) * 12;
  if (z <= 16) return 30 + ((z - 14) / 2) * 18;
  return 48;
}

interface HeatLayerProps {
  data: Position[];
  opacity?: number;
}

export default function HeatLayer({ data, opacity = 0.55 }: HeatLayerProps) {
  const { viewState } = useMapContext();
  const zoom = viewState?.zoom ?? DEFAULT_ZOOM;
  const radiusPixels = heatRadiusForZoom(zoom);

  const layers = useMemo(() => {
    if (data.length === 0) return [];

    return [
      new HeatmapLayer<Position>({
        id: "heatmap",
        data,
        getPosition: (d: Position) => d,
        getWeight: 1,
        radiusPixels,
        intensity: 1,
        // Drops the faintest tail of the kernel so sparse, isolated vehicles
        // don't each paint a pale halo over the road network.
        threshold: 0.08,
        colorRange: heatColorRange(),
        opacity,
        debounceTimeout: 500,
        weightsTextureSize: 512,
        pickable: false,
      }),
    ];
  }, [data, opacity, radiusPixels]);

  useRegisterLayers("heatmap", layers);

  return null;
}

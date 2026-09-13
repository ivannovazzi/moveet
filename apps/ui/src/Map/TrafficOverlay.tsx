import { useMemo } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import { useTraffic } from "@/hooks/useTraffic";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { TrafficIcon } from "@/components/Icons";
import { resolveMapColor } from "@/lib/mapColor";
import { CASING_TOKEN } from "@/lib/mapLabels";
import type { TrafficEdge } from "@/types";
import ScaleLegend, { type LegendColor } from "./ScaleLegend";
import { renderInSlot, type LegendSlot } from "./LegendStack";

type RGBA = [number, number, number, number];

/** Congestion factor bounds as emitted by the simulator's TrafficManager. */
const CONGESTION_MIN = 0.2;
const CONGESTION_MAX = 1;

/**
 * Real-world carriageway width per highway class, in meters. Rendering in
 * meters (clamped in pixels below) makes the overlay track the road as the user
 * zooms instead of staying a hairline at street level.
 */
const HIGHWAY_WIDTH_M: Record<string, number> = {
  motorway: 16,
  motorway_link: 10,
  trunk: 14,
  trunk_link: 9,
  primary: 12,
  primary_link: 8,
  secondary: 9,
  tertiary: 7,
};
const DEFAULT_WIDTH_M = 5;
// Segments are short (one node pair), so at city zoom the width floor is what
// keeps them from vanishing under the vehicle sprites.
const MIN_WIDTH_PX = 3;
const MAX_WIDTH_PX = 12;

/** Dark outline drawn under the colour line so it reads over grey roads —
 *  CASING_TOKEN is the shared map-label casing. */
const CASING_ALPHA = 230;
const CASING_SCALE = 1.7;
const CASING_MIN_PX = 6;
const CASING_MAX_PX = 18;

/**
 * Colour stops over the congestion factor (1 = free flow, 0.2 = jammed).
 * Congestion = 1 / (1 + r²) for occupancy ratio r, so 0.8 is half capacity and
 * 0.5 is at capacity. Between stops the colour is interpolated, so the overlay
 * reads as a continuous ramp instead of three hard buckets.
 */
const CONGESTION_STOPS: ReadonlyArray<readonly [number, string, string]> = [
  [0.2, "var(--color-traffic-jam)", "Jammed"],
  [0.35, "var(--color-traffic-congested)", "Jammed"],
  [0.5, "var(--color-traffic-heavy)", "Heavy"],
  [0.7, "var(--color-traffic-slow)", "Slow"],
  [0.9, "var(--color-traffic-free)", "Free flow"],
];

/** Label of the band a value falls in, past the last stop included. */
const TOP_BAND_LABEL = CONGESTION_STOPS[CONGESTION_STOPS.length - 1][2];

/** Swatch count for the legend bar. The map itself is continuous. */
const LEGEND_STEPS = 8;
const LEGEND_DOMAIN: readonly [number, number] = [CONGESTION_MIN, CONGESTION_MAX];

type Lab = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function rgbToOklab([r8, g8, b8]: RGBA): Lab {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, A, B]: Lab, alpha: number): RGBA {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    Math.round(alpha),
  ];
}

/**
 * Interpolation across sorted `[value, rgba]` stops, clamped at both ends.
 * Blends in OKLab rather than sRGB: an sRGB mix of amber and green goes muddy
 * olive, and a mix of two reds drifts toward pink.
 */
export function interpolateStops(
  stops: ReadonlyArray<readonly [number, RGBA]>,
  value: number
): RGBA {
  if (value <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [hi, hiColor] = stops[i];
    if (value > hi) continue;
    const [lo, loColor] = stops[i - 1];
    const t = (value - lo) / (hi - lo);
    const a = rgbToOklab(loColor);
    const b = rgbToOklab(hiColor);
    return oklabToRgb(
      [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      loColor[3] + (hiColor[3] - loColor[3]) * t
    );
  }
  return last[1];
}

let resolvedStops: Array<readonly [number, RGBA]> | null = null;

/**
 * Congestion factor to an opaque colour. Opaque on purpose: adjacent segments
 * overlap at their rounded caps, and any alpha would darken every joint.
 */
export function congestionColor(factor: number): RGBA {
  resolvedStops ??= CONGESTION_STOPS.map(([v, token]) => [v, resolveMapColor(token)] as const);
  return interpolateStops(resolvedStops, factor);
}

/** One road segment with a vehicle on it, both travel directions merged. */
export interface TrafficSegment {
  path: [number, number][];
  congestion: number;
  widthMeters: number;
}

/**
 * Collapse the per-direction edge snapshot into drawable segments.
 *
 * The simulator emits one edge per consecutive node pair per direction, each
 * carrying its exact two-point geometry. Forward and reverse edges share the
 * same line, so they are merged (worst congestion wins) to avoid drawing the
 * same segment twice. The result is sorted best-to-worst so jams draw on top
 * where segments meet.
 */
export function buildTrafficSegments(edges: readonly TrafficEdge[]): TrafficSegment[] {
  const byKey = new Map<string, TrafficSegment>();
  for (const edge of edges) {
    const coords = edge.coordinates;
    if (coords.length < 2) continue;
    const a = `${coords[0][0]},${coords[0][1]}`;
    const b = `${coords[coords.length - 1][0]},${coords[coords.length - 1][1]}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = byKey.get(key);
    if (existing) {
      if (edge.congestion < existing.congestion) existing.congestion = edge.congestion;
      continue;
    }
    byKey.set(key, {
      path: coords,
      congestion: edge.congestion,
      widthMeters: HIGHWAY_WIDTH_M[edge.highway] ?? DEFAULT_WIDTH_M,
    });
  }
  return Array.from(byKey.values()).sort((x, y) => y.congestion - x.congestion);
}

/**
 * Congestion factor as the words a dispatcher uses.
 *
 * The bands are read off `CONGESTION_STOPS` rather than restated as literals:
 * the words then name exactly the colours the map paints, and a retuned stop
 * moves both at once instead of leaving the legend describing the old ramp.
 */
function formatCongestion(value: number): string {
  for (const [breakpoint, , label] of CONGESTION_STOPS) {
    if (value <= breakpoint) return label;
  }
  return TOP_BAND_LABEL;
}

const NO_LAYERS: Layer[] = [];

interface TrafficOverlayProps {
  visible: boolean;
  /** Where the legend is portalled; inline when absent (tests, no stack yet). */
  legendSlot?: LegendSlot;
}

export default function TrafficOverlay({ visible, legendSlot }: TrafficOverlayProps) {
  const { edges } = useTraffic();

  const segments = useMemo(() => buildTrafficSegments(edges), [edges]);

  const legendColors = useMemo<LegendColor[]>(() => {
    const colors: LegendColor[] = [];
    const step = (CONGESTION_MAX - CONGESTION_MIN) / LEGEND_STEPS;
    for (let i = 0; i < LEGEND_STEPS; i++) {
      colors.push(congestionColor(CONGESTION_MIN + (i + 0.5) * step));
    }
    return colors;
  }, []);

  // `segments` is a fresh array per traffic tick (the occupied-edge set changes
  // with it), so geometry and colour upload together; the set is bounded by the
  // number of moving vehicles, which keeps the per-tick upload small.
  const layers = useMemo(() => {
    if (!visible || segments.length === 0) return NO_LAYERS;
    const shared = {
      data: segments,
      getPath: (d: TrafficSegment) => d.path,
      widthUnits: "meters" as const,
      jointRounded: true,
      capRounded: true,
      pickable: false,
    };
    return [
      new PathLayer<TrafficSegment>({
        ...shared,
        id: "traffic-overlay-casing",
        getColor: resolveMapColor(CASING_TOKEN, CASING_ALPHA),
        getWidth: (d) => d.widthMeters * CASING_SCALE,
        widthMinPixels: CASING_MIN_PX,
        widthMaxPixels: CASING_MAX_PX,
      }),
      new PathLayer<TrafficSegment>({
        ...shared,
        id: "traffic-overlay",
        getColor: (d) => congestionColor(d.congestion),
        getWidth: (d) => d.widthMeters,
        widthMinPixels: MIN_WIDTH_PX,
        widthMaxPixels: MAX_WIDTH_PX,
      }),
    ];
  }, [visible, segments]);

  useRegisterLayers("traffic-overlay", layers);

  if (!visible) return null;

  return renderInSlot(
    legendSlot,
    "traffic",
    <ScaleLegend
      testId="traffic-legend"
      title="Traffic"
      subtitle="Road segments with vehicles"
      icon={TrafficIcon}
      colorRange={legendColors}
      domain={LEGEND_DOMAIN}
      formatValue={formatCongestion}
    />
  );
}

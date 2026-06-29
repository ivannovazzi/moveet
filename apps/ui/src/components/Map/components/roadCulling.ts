// Pure viewport-culling + zoom-LOD helpers for the road PathLayers.
//
// A large city network can be ~160k LineString features. Binding the full
// arrays as PathLayer.data forces deck.gl to keep all geometry resident and
// re-tessellate on changes, which saturates GPU/CPU on every pan/zoom. We
// instead bind only the features that (a) intersect the current viewport plus
// a margin and (b) survive the zoom level-of-detail filter. The logic here is
// kept dependency-free and side-effect-free so it can be unit tested directly.
import type { RoadNetwork } from "@/types";

type RoadFeature = RoadNetwork["features"][number];

/** Axis-aligned bounds of one feature: [minLng, minLat, maxLng, maxLat]. */
export type FeatureBounds = [number, number, number, number];

/** Viewport bbox as exposed by useMapContext().getBoundingBox(): [[w,s],[e,n]]. */
export type ViewportBox = [[number, number], [number, number]];

/**
 * Fraction of the viewport span added as a margin on every side before
 * culling, so roads just off-screen are already bound when the user pans into
 * them. Matches the vehicle layer's 25% margin for consistent behaviour.
 */
export const CULL_MARGIN = 0.25;

/**
 * Below this zoom the network is so dense on screen that minor classes are
 * visual noise and a tessellation tax, so we render only the major arterials
 * (see MAJOR_HIGHWAY_CLASSES). At or above it, every class is rendered, so a
 * fully zoomed-in view never drops a road.
 */
export const LOD_MIN_ZOOM_FOR_MINOR_ROADS = 13;

/**
 * Major road classes always rendered, even at low zoom. Values match OSM
 * `highway=*` tags carried on each feature's `properties.highway`. Anything
 * not in this set (residential, service, unclassified, etc.) is treated as a
 * minor road and only shown once zoomed in past LOD_MIN_ZOOM_FOR_MINOR_ROADS.
 */
export const MAJOR_HIGHWAY_CLASSES: ReadonlySet<string> = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
]);

/** Precompute the axis-aligned bounds of every feature once per network load. */
export function computeFeatureBounds(features: readonly RoadFeature[]): FeatureBounds[] {
  const out: FeatureBounds[] = new Array(features.length);
  for (let i = 0; i < features.length; i++) {
    const coords = features[i].geometry.coordinates;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    out[i] = [minLng, minLat, maxLng, maxLat];
  }
  return out;
}

/** True when the zoom level is high enough that minor road classes render. */
export function shouldRenderMinorRoads(zoom: number): boolean {
  return zoom >= LOD_MIN_ZOOM_FOR_MINOR_ROADS;
}

/** True when this feature passes the zoom LOD filter (major always; minor only zoomed in). */
function passesLod(feature: RoadFeature, renderMinor: boolean): boolean {
  if (renderMinor) return true;
  const cls = feature.properties.highway;
  return cls !== undefined && MAJOR_HIGHWAY_CLASSES.has(cls);
}

/**
 * Returns the subset of `features` that should be bound to a PathLayer at the
 * given viewport + zoom: those whose precomputed bounds intersect the viewport
 * (expanded by CULL_MARGIN) and that survive the zoom LOD filter.
 *
 * A degenerate viewport (zero/negative span, e.g. before the first layout)
 * disables culling and returns the LOD-filtered full set so nothing is hidden.
 *
 * `bounds[i]` must correspond to `features[i]` (see computeFeatureBounds).
 */
export function cullRoadFeatures(
  features: readonly RoadFeature[],
  bounds: readonly FeatureBounds[],
  viewport: ViewportBox,
  zoom: number,
  margin: number = CULL_MARGIN
): RoadFeature[] {
  const renderMinor = shouldRenderMinorRoads(zoom);
  const [[west, south], [east, north]] = viewport;

  const spanLng = east - west;
  const spanLat = north - south;
  const cullEnabled = spanLng > 1e-9 && spanLat > 1e-9;

  const marginLng = spanLng * margin;
  const marginLat = spanLat * margin;
  const minLng = west - marginLng;
  const maxLng = east + marginLng;
  const minLat = south - marginLat;
  const maxLat = north + marginLat;

  const out: RoadFeature[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!passesLod(f, renderMinor)) continue;
    if (cullEnabled) {
      const [fMinLng, fMinLat, fMaxLng, fMaxLat] = bounds[i];
      // Reject when the feature bbox is entirely outside the padded viewport.
      if (fMaxLng < minLng || fMinLng > maxLng || fMaxLat < minLat || fMinLat > maxLat) {
        continue;
      }
    }
    out.push(f);
  }
  return out;
}

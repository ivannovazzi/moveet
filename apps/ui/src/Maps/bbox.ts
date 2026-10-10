import type { MapMeta } from "@moveet/shared-types";
import type { Bbox } from "./mapsClient";

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

/**
 * Area of a lon/lat box on a spherical Earth, in km². The same formula the
 * simulator checks a build against, so the cap shown here is the cap enforced.
 */
export function bboxAreaKm2([w, s, e, n]: Bbox): number {
  return (
    EARTH_RADIUS_KM ** 2 * Math.abs((e - w) * RAD) * Math.abs(Math.sin(n * RAD) - Math.sin(s * RAD))
  );
}

/** Width and height of the box in km, measured across its middle. */
export function bboxSpanKm([w, s, e, n]: Bbox): { widthKm: number; heightKm: number } {
  const midLat = ((s + n) / 2) * RAD;
  return {
    widthKm: Math.abs(e - w) * RAD * EARTH_RADIUS_KM * Math.cos(midLat),
    heightKm: Math.abs(n - s) * RAD * EARTH_RADIUS_KM,
  };
}

/** Why `bbox` cannot be built, or null when it is usable. */
export function bboxProblem(bbox: Bbox): string | null {
  const [w, s, e, n] = bbox;
  if (!bbox.every(Number.isFinite)) return "The area has invalid coordinates.";
  if (w < -180 || e > 180 || s < -90 || n > 90) return "The area is outside the world.";
  if (w >= e || s >= n) return "The area is empty.";
  return null;
}

/** Two corners in any order, as a normalized box clamped to Web Mercator's range. */
export function bboxFromCorners(a: [number, number], b: [number, number]): Bbox {
  const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
  const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
  return [
    clampLon(Math.min(a[0], b[0])),
    clampLat(Math.min(a[1], b[1])),
    clampLon(Math.max(a[0], b[0])),
    clampLat(Math.max(a[1], b[1])),
  ];
}

/** Corner pairs for `setBounds`: `[[west, south], [east, north]]`. */
export function bboxCorners([w, s, e, n]: Bbox): [[number, number], [number, number]] {
  return [
    [w, s],
    [e, n],
  ];
}

/** Closed ring for a PolygonLayer. */
export function bboxRing([w, s, e, n]: Bbox): [number, number][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/**
 * A rough guess at a new map's size, from the road density of the maps already
 * in the library (bytes of road network per km² of their boxes). Null when
 * there is nothing to learn from. Buildings are not counted: their share
 * varies too much between cities to say anything useful.
 */
export function estimateNetworkBytes(bbox: Bbox, library: MapMeta[]): number | null {
  let bytes = 0;
  let area = 0;
  for (const m of library) {
    if (!m.bbox || !m.sizes?.networkBytes) continue;
    const a = bboxAreaKm2(m.bbox);
    if (!(a > 0)) continue;
    bytes += m.sizes.networkBytes;
    area += a;
  }
  if (area === 0) return null;
  return (bytes / area) * bboxAreaKm2(bbox);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatArea(km2: number): string {
  if (km2 >= 100) return `${Math.round(km2).toLocaleString()} km²`;
  return `${km2.toFixed(1)} km²`;
}

/** Centre of the box as `lat, lon`, the order people read coordinates in. */
export function formatCentre([w, s, e, n]: Bbox): string {
  return `${((s + n) / 2).toFixed(3)}, ${((w + e) / 2).toFixed(3)}`;
}

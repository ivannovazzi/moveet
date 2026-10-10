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

/** Typed bounds, as the text of the W, S, E and N fields. */
export type BoundsText = [string, string, string, string];

export const BOUND_NAMES = ["West", "South", "East", "North"] as const;

/**
 * Typed W/S/E/N bounds (decimal degrees) as a box, or why they are not one:
 * each must be a finite number in range, west before east and south before
 * north, and the box no larger than `maxKm2` when there is a cap.
 */
export function parseBounds(
  text: BoundsText,
  maxKm2: number | null
): { ok: true; bbox: Bbox } | { ok: false; error: string } {
  const values: number[] = [];
  for (let i = 0; i < 4; i++) {
    const raw = text[i].trim();
    const v = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(v)) return { ok: false, error: `${BOUND_NAMES[i]} is not a number.` };
    const limit = i % 2 === 0 ? 180 : 90;
    if (v < -limit || v > limit) {
      return { ok: false, error: `${BOUND_NAMES[i]} must be between -${limit} and ${limit}.` };
    }
    values.push(v);
  }
  const bbox = values as Bbox;
  const [w, s, e, n] = bbox;
  if (w >= e) return { ok: false, error: "West must be less than East." };
  if (s >= n) return { ok: false, error: "South must be less than North." };
  if (maxKm2 !== null && bboxAreaKm2(bbox) > maxKm2) {
    return {
      ok: false,
      error: `That area is ${formatArea(bboxAreaKm2(bbox))}, over the ${formatArea(maxKm2)} limit.`,
    };
  }
  return { ok: true, bbox };
}

/**
 * The box scaled about its centre until its area is at most `maxKm2` (aiming a
 * hair under, so rounding cannot tip it back over). Its proportions in degrees
 * are kept. A box already within the cap comes back unchanged.
 */
export function shrinkToArea(bbox: Bbox, maxKm2: number, target = 0.99): Bbox {
  if (bboxAreaKm2(bbox) <= maxKm2) return bbox;
  const [w, s, e, n] = bbox;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const hw = (e - w) / 2;
  const hh = (n - s) / 2;
  const scaled = (k: number): Bbox => [cx - hw * k, cy - hh * k, cx + hw * k, cy + hh * k];
  // Area grows monotonically with the scale, so bisect it.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bboxAreaKm2(scaled(mid)) <= maxKm2 * target) lo = mid;
    else hi = mid;
  }
  // Round inwards, so the rounded box stays under the cap.
  const [sw, ss, se, sn] = scaled(lo);
  const down = (v: number) => Math.ceil(v * 1e5) / 1e5;
  const up = (v: number) => Math.floor(v * 1e5) / 1e5;
  return [down(sw), down(ss), up(se), up(sn)];
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

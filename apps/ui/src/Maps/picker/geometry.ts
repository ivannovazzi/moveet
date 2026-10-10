import { WebMercatorViewport } from "@deck.gl/core";
import { bboxAreaKm2 } from "../bbox";
import type { Bbox } from "../mapsClient";

/**
 * Pure geometry for the area picker: camera framing and the edits a drag on
 * the box makes. Kept apart from the component so it is tested without WebGL.
 */

export interface PickerViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** Web Mercator stops here; boxes are clamped to it like the old draw tool. */
export const MAX_LAT = 85;
export const MIN_ZOOM = 0;
export const MAX_ZOOM = 16;

/**
 * Opening on the active map stops at about country scale: the picker has no
 * streets to show, so a city-sized frame would be an empty field of land.
 */
export const OPENING_MAX_ZOOM = 6;

export const WORLD_VIEW: PickerViewState = {
  longitude: 10,
  latitude: 25,
  zoom: 0.6,
  pitch: 0,
  bearing: 0,
};

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clampLon = (v: number) => Math.max(-180, Math.min(180, v));
const clampLat = (v: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, v));

export function viewportFor(view: PickerViewState, width: number, height: number) {
  return new WebMercatorViewport({ ...view, width, height });
}

/** Screen position (px) to `[lon, lat]`, or null off the map. */
export function unprojectPx(
  view: PickerViewState,
  width: number,
  height: number,
  px: [number, number]
): [number, number] | null {
  if (!width || !height) return null;
  const [lon, lat] = viewportFor(view, width, height).unproject(px);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/** `[lon, lat]` to a screen position (px). */
export function projectLngLat(
  view: PickerViewState,
  width: number,
  height: number,
  at: [number, number]
): [number, number] {
  const [x, y] = viewportFor(view, width, height).project(at);
  return [x, y];
}

/**
 * The camera that frames `bbox` with `padding` px around it, zoomed in no
 * further than `maxZoom` (so a small box still shows its surroundings).
 */
export function viewForBbox(
  bbox: Bbox,
  width: number,
  height: number,
  padding = 48,
  maxZoom = 14
): PickerViewState {
  if (!width || !height) return WORLD_VIEW;
  const [w, s, e, n] = bbox;
  const pad = Math.max(0, Math.min(padding, Math.floor(Math.min(width, height) / 4)));
  // A degenerate box (a point) still needs a little extent to fit.
  const eps = 1e-4;
  const { longitude, latitude, zoom } = viewportFor(WORLD_VIEW, width, height).fitBounds(
    [
      [clampLon(Math.min(w, e - eps)), clampLat(Math.min(s, n - eps))],
      [clampLon(Math.max(e, w + eps)), clampLat(Math.max(n, s + eps))],
    ],
    { padding: pad, maxZoom }
  );
  return { longitude, latitude, zoom: Math.max(MIN_ZOOM, zoom), pitch: 0, bearing: 0 };
}

/** A normalized box from two corners, clamped to the world (Web Mercator's range). */
export function boxFromCorners(a: [number, number], b: [number, number]): Bbox {
  return [
    clampLon(Math.min(a[0], b[0])),
    clampLat(Math.min(a[1], b[1])),
    clampLon(Math.max(a[0], b[0])),
    clampLat(Math.max(a[1], b[1])),
  ];
}

/**
 * The box drawn from `anchor` (where the drag began) to `to` (the pointer).
 * Past `maxKm2` the far corner is pulled back along the drag towards the
 * anchor, a hair under the cap so rounding cannot tip it over; `capped` says
 * so. The anchor never moves.
 */
export function drawBox(
  anchor: [number, number],
  to: [number, number],
  maxKm2: number | null
): { bbox: Bbox; capped: boolean } {
  const full = boxFromCorners(anchor, to);
  if (maxKm2 === null || bboxAreaKm2(full) <= maxKm2) return { bbox: full, capped: false };
  const at = (k: number): Bbox =>
    boxFromCorners(anchor, [
      anchor[0] + (to[0] - anchor[0]) * k,
      anchor[1] + (to[1] - anchor[1]) * k,
    ]);
  // Area grows monotonically with the scale, so bisect it.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bboxAreaKm2(at(mid)) <= maxKm2 * 0.99) lo = mid;
    else hi = mid;
  }
  return { bbox: at(lo), capped: true };
}

/**
 * The box after dragging `handle` to `to`: the handle's edges follow the
 * pointer and the opposite ones stay put. Dragging past the opposite edge
 * flips the box rather than inverting it.
 */
export function resizeBox(start: Bbox, handle: Handle, to: [number, number]): Bbox {
  let [w, s, e, n] = start;
  if (handle.includes("w")) w = to[0];
  if (handle.includes("e")) e = to[0];
  if (handle.includes("s")) s = to[1];
  if (handle.includes("n")) n = to[1];
  return boxFromCorners([w, s], [e, n]);
}

/** The box shifted by a pointer delta, kept whole inside the world. */
export function moveBox(start: Bbox, dLon: number, dLat: number): Bbox {
  const [w, s, e, n] = start;
  const dx = Math.max(-180 - w, Math.min(180 - e, dLon));
  const dy = Math.max(-MAX_LAT - s, Math.min(MAX_LAT - n, dLat));
  return [w + dx, s + dy, e + dx, n + dy];
}

/** Closed ring for a PolygonLayer. */
export function ring([w, s, e, n]: Bbox): [number, number][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

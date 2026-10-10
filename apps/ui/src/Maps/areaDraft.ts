import { useSyncExternalStore } from "react";
import type { Bbox } from "./mapsClient";

/**
 * The area a new map is being built from, shared between the New map form
 * (search and results) and the area picker's world map (which shows the
 * places live, flies to them, and lets the operator adjust the box). The two
 * are separate components, so this is a tiny module store rather than
 * context, like `data/mapRevision`.
 */

/** A place boundary, as MultiPolygon coordinates. */
export type Outline = [number, number][][][];

export interface PlaceArea {
  bbox: Bbox;
  outline?: Outline;
}

export interface ResolvedExtract {
  /** Path of the extract the build will download, or null. */
  selected: string | null;
}

/** Where the current box came from, so the form can follow it. */
export interface AreaSource {
  kind: "search" | "draw" | "bounds" | "preset";
  /** A name to suggest for the map (a preset's label). */
  name?: string;
}

export interface AreaDraft {
  /** The box the map will be built from, exactly; null until one is chosen. */
  bbox: Bbox | null;
  /** The boundary of the place the box was chosen from, if it has one. */
  outline: Outline | null;
  /** The place being looked at in the results (hovered, or the top hit). */
  preview: PlaceArea | null;
  /** Where the picker should fly; a new `seq` asks again for the same box. */
  focus: { bbox: Bbox; seq: number } | null;
  /** The Geofabrik extract the form resolved for the box, for the picker to highlight. */
  extract: ResolvedExtract;
  /** How the box was last chosen, with a new `seq` per choice. Adjusting keeps it. */
  source: (AreaSource & { seq: number }) | null;
}

const IDLE: AreaDraft = {
  bbox: null,
  outline: null,
  preview: null,
  focus: null,
  extract: { selected: null },
  source: null,
};

let state: AreaDraft = IDLE;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: AreaDraft): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getAreaDraft(): AreaDraft {
  return state;
}

/** Rounds to 5 decimals (about 1 m): what the form shows is exactly what is sent. */
export function roundBbox(bbox: Bbox): Bbox {
  return bbox.map((v) => Math.round(v * 1e5) / 1e5) as Bbox;
}

/**
 * Chooses the box to build (a search result, typed bounds or a preset), and
 * flies the picker to it.
 */
export function selectArea(
  bbox: Bbox,
  outline?: Outline,
  source: AreaSource = { kind: "search" }
): void {
  const rounded = roundBbox(bbox);
  set({
    ...state,
    bbox: rounded,
    outline: outline ?? null,
    preview: null,
    focus: { bbox: rounded, seq: ++seq },
    source: { ...source, seq: ++seq },
  });
}

/** A box drawn by hand on the picker: it replaces any other, where it is, with no flight. */
export function drawArea(bbox: Bbox): void {
  set({
    ...state,
    bbox: roundBbox(bbox),
    outline: null,
    preview: null,
    source: { kind: "draw", seq: ++seq },
  });
}

/** The box after a drag on the map: same place, no flight. */
export function adjustArea(bbox: Bbox): void {
  set({ ...state, bbox: roundBbox(bbox) });
}

/** Shows a place on the picker as the operator looks through the results. */
export function previewArea(area: PlaceArea | null, fly = true): void {
  const same =
    state.preview?.bbox.join(",") === area?.bbox.join(",") &&
    (state.preview === null) === (area === null);
  if (same) return;
  set({
    ...state,
    preview: area,
    focus: area && fly ? { bbox: area.bbox, seq: ++seq } : state.focus,
  });
}

export function setResolvedExtract(extract: ResolvedExtract): void {
  if (state.extract.selected === extract.selected) return;
  set({ ...state, extract });
}

/** Drops everything: the form closed. */
export function clearAreaDraft(): void {
  if (state === IDLE) return;
  set(IDLE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAreaDraft(): AreaDraft {
  return useSyncExternalStore(subscribe, getAreaDraft, getAreaDraft);
}

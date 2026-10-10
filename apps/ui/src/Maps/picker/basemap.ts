import { useEffect, useState } from "react";
import type { GeofabrikOutlinesResponse } from "../mapsClient";
import { listGeofabrikOutlines } from "../mapsClient";

/**
 * Data behind the area picker's world map, fetched only when the picker
 * opens and kept for the session:
 *
 *  - the basemap: Natural Earth 1:50m countries (public domain), a static
 *    asset shipped with the UI (`public/basemap/countries.geojson`, built by
 *    `scripts/build-basemap.mjs`), so no tile service or key is involved;
 *  - Geofabrik's extract outlines from the simulator. Optional: when they
 *    cannot be loaded the picker works with countries alone.
 */

export interface Country {
  type: "Feature";
  properties: { name: string; label: [number, number]; minZoom: number };
  geometry: { type: "MultiPolygon"; coordinates: [number, number][][][] };
}

export interface Basemap {
  countries: Country[];
}

export const BASEMAP_URL = `${import.meta.env.BASE_URL ?? "/"}basemap/countries.geojson`;

function isCountry(f: unknown): f is Country {
  if (typeof f !== "object" || f === null) return false;
  const { properties, geometry } = f as Partial<Country>;
  return (
    typeof properties?.name === "string" &&
    Array.isArray(properties.label) &&
    geometry?.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  );
}

let basemapPromise: Promise<Basemap> | null = null;

/** Loads the countries once; a failed load is retried on the next call. */
export function loadBasemap(): Promise<Basemap> {
  basemapPromise ??= fetch(BASEMAP_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`The world map failed to load (status ${res.status})`);
      return res.json() as Promise<{ features?: unknown[] }>;
    })
    .then((body) => ({ countries: (body.features ?? []).filter(isCountry) }))
    .catch((err: unknown) => {
      basemapPromise = null;
      throw err;
    });
  return basemapPromise;
}

let outlinesPromise: Promise<GeofabrikOutlinesResponse | null> | null = null;

/** Loads the Geofabrik outlines once; null (countries only) when the simulator cannot serve them. */
export function loadOutlines(): Promise<GeofabrikOutlinesResponse | null> {
  outlinesPromise ??= listGeofabrikOutlines().then((res) => {
    if (res.ok) return res.data;
    // Try again next time the picker opens.
    outlinesPromise = null;
    return null;
  });
  return outlinesPromise;
}

/** Test seam: forget what was loaded. */
export function resetPickerData(): void {
  basemapPromise = null;
  outlinesPromise = null;
}

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

function useLoad<T>(load: () => Promise<T>): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ status: "ready", data }),
      (err: unknown) =>
        live &&
        setState({ status: "error", error: err instanceof Error ? err.message : String(err) })
    );
    return () => {
      live = false;
    };
  }, [load]);
  return state;
}

export function useBasemap(): Loadable<Basemap> {
  return useLoad(loadBasemap);
}

export function useOutlines(): Loadable<GeofabrikOutlinesResponse | null> {
  return useLoad(loadOutlines);
}

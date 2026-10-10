import type {
  GeocodeResponse,
  GeofabrikLookupResponse,
  GeofabrikOutline,
  GeofabrikOutlinesResponse,
  GeofabrikRegion,
  MapActivateResponse,
  MapBuildAccepted,
  MapBuildLimits,
  MapBuildRequest,
  MapJob,
  MapMeta,
  MapPreset,
} from "@moveet/shared-types";
import { config } from "@/utils/config";

/**
 * Every call the Maps panel makes, in one place, typed against the simulator's
 * map library contract in `@moveet/shared-types`.
 *
 * Calls never throw. They resolve to a `MapsResponse` carrying the HTTP status,
 * because the panel acts on it: 404 on `/maps/presets` means the server cannot
 * build maps, 429 on `/maps/geocode` means "slow down", 409 means "busy".
 * Bodies are checked for their outer shape before they are trusted, so an
 * older simulator degrades to "not supported" rather than to a crash.
 */

export type {
  GeocodeResponse,
  GeocodeResult,
  GeofabrikLookupResponse,
  GeofabrikOutline,
  GeofabrikOutlinesResponse,
  GeofabrikRegion,
  MapBuildLimits,
  MapBuildRequest,
  MapJob,
  MapJobStatus,
  MapPreset,
} from "@moveet/shared-types";

/** `[west, south, east, north]` in degrees. */
export type Bbox = [number, number, number, number];

export type MapsResponse<T> =
  | { ok: true; status: number; data: T }
  /** `status` is 0 when the request never got an HTTP answer. */
  | { ok: false; status: number; error: string };

/** `GET /maps`, with the build capabilities folded into one optional field. */
export interface MapLibrary {
  maps: MapMeta[];
  activeId: string;
  switching: boolean;
  /** Null when the server predates map builds (no `buildsAllowed` field). */
  builds: { allowed: boolean; limits: MapBuildLimits } | null;
}

// ─── Parsing ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBbox(v: unknown): v is Bbox {
  return Array.isArray(v) && v.length === 4 && v.every((x) => Number.isFinite(x));
}

/** The array under `key` of a `{ [key]: [...] }` envelope, or null. */
function envelope(body: unknown, key: string): unknown[] | null {
  return isObj(body) && Array.isArray(body[key]) ? (body[key] as unknown[]) : null;
}

export function parseMapList(body: unknown): MapLibrary | null {
  if (!isObj(body) || !Array.isArray(body.maps)) return null;
  const maps = body.maps.filter(
    (m): m is MapMeta => isObj(m) && typeof m.id === "string" && typeof m.label === "string"
  );
  const limits = isObj(body.buildLimits) ? (body.buildLimits as unknown as MapBuildLimits) : null;
  return {
    maps,
    activeId: typeof body.activeId === "string" ? body.activeId : "",
    switching: body.switching === true,
    builds:
      typeof body.buildsAllowed === "boolean" && limits
        ? { allowed: body.buildsAllowed, limits }
        : null,
  };
}

const JOB_STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

/** A job (REST or the `mapjob` WebSocket payload), or null when it is not one. */
export function parseMapJob(v: unknown): MapJob | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  if (typeof v.status !== "string" || !JOB_STATUSES.has(v.status)) return null;
  const progress = typeof v.progress === "number" && Number.isFinite(v.progress) ? v.progress : 0;
  return {
    ...(v as unknown as MapJob),
    step: (typeof v.step === "string" ? v.step : v.status) as MapJob["step"],
    progress: Math.min(1, Math.max(0, progress)),
  };
}

export function parseMapJobs(body: unknown): MapJob[] | null {
  const list = envelope(body, "jobs");
  return list ? list.map(parseMapJob).filter((j): j is MapJob => j !== null) : null;
}

export function parsePresets(body: unknown): MapPreset[] | null {
  const list = envelope(body, "presets");
  if (!list) return null;
  return list.filter(
    (p): p is MapPreset =>
      isObj(p) && typeof p.name === "string" && typeof p.label === "string" && isBbox(p.bbox)
  );
}

export function parseGeofabrik(body: unknown): GeofabrikRegion[] | null {
  const list = envelope(body, "regions");
  if (!list) return null;
  return list.filter((r): r is GeofabrikRegion => isObj(r) && typeof r.path === "string");
}

/** `GET /maps/geofabrik`: the containing extracts, and the borders the box crosses. */
export function parseGeofabrikLookup(body: unknown): GeofabrikLookupResponse | null {
  const regions = parseGeofabrik(body);
  if (!regions || !isObj(body)) return null;
  const crosses = Array.isArray(body.crosses)
    ? body.crosses.filter(
        (c): c is { path: string; name: string } =>
          isObj(c) && typeof c.path === "string" && typeof c.name === "string"
      )
    : [];
  return crosses.length > 1 ? { regions, crosses } : { regions };
}

function isRing(v: unknown): v is [number, number][] {
  return (
    Array.isArray(v) &&
    v.length >= 4 &&
    v.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  );
}

/** `GET /maps/geofabrik/regions`, keeping only outlines with drawable rings. */
export function parseGeofabrikOutlines(body: unknown): GeofabrikOutlinesResponse | null {
  const list = envelope(body, "regions");
  if (!list || !isObj(body)) return null;
  const regions = list.filter(
    (r): r is GeofabrikOutline =>
      isObj(r) &&
      typeof r.path === "string" &&
      typeof r.name === "string" &&
      typeof r.depth === "number" &&
      Array.isArray(r.polygons) &&
      r.polygons.every((poly) => Array.isArray(poly) && poly.every(isRing))
  );
  return {
    regions,
    attribution: typeof body.attribution === "string" ? body.attribution : "",
  };
}

export function parseGeocode(body: unknown): GeocodeResponse | null {
  const list = envelope(body, "results");
  if (!list || !isObj(body)) return null;
  return {
    results: list.filter(
      (c): c is GeocodeResponse["results"][number] =>
        isObj(c) && typeof c.name === "string" && isBbox(c.bbox)
    ),
    attribution: typeof body.attribution === "string" ? body.attribution : "",
  };
}

// ─── Transport ───────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;

async function readError(res: Response, label: string): Promise<string> {
  try {
    const body = (await res.json()) as unknown;
    if (isObj(body) && typeof body.error === "string") {
      const details = Array.isArray(body.details)
        ? body.details.filter((d): d is string => typeof d === "string").join("; ")
        : "";
      return details ? `${body.error}: ${details}` : body.error;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${label} failed with status ${res.status}`;
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  parse: (body: unknown) => T | null,
  options: { body?: unknown; signal?: AbortSignal; timeout?: number } = {}
): Promise<MapsResponse<T>> {
  const label = `${method} ${path}`;
  const timeout = AbortSignal.timeout(options.timeout ?? REQUEST_TIMEOUT);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${config.apiUrl}${path}`, {
      method,
      signal,
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) return { ok: false, status: res.status, error: await readError(res, label) };
    const text = res.status === 204 ? "" : await res.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    const data = parse(body);
    if (data === null) {
      return { ok: false, status: res.status, error: `${label} returned an unexpected body` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  }
}

const enc = encodeURIComponent;

export function listMaps(signal?: AbortSignal): Promise<MapsResponse<MapLibrary>> {
  return request("GET", "/maps", parseMapList, { signal });
}

export function activateMap(id: string): Promise<MapsResponse<MapActivateResponse>> {
  // A swap rebuilds the routing graph, which can take a while on a big city.
  return request(
    "POST",
    `/maps/${enc(id)}/activate`,
    (b) => (isObj(b) && isObj(b.map) ? (b as unknown as MapActivateResponse) : null),
    { timeout: 180_000 }
  );
}

export function deleteMap(id: string): Promise<MapsResponse<true>> {
  return request("DELETE", `/maps/${enc(id)}`, () => true);
}

export function buildMap(req: MapBuildRequest): Promise<MapsResponse<MapBuildAccepted>> {
  return request("POST", "/maps", parseMapJob, { body: req });
}

export function listMapJobs(signal?: AbortSignal): Promise<MapsResponse<MapJob[]>> {
  return request("GET", "/maps/jobs", parseMapJobs, { signal });
}

export function cancelMapJob(id: string): Promise<MapsResponse<true>> {
  return request("DELETE", `/maps/jobs/${enc(id)}`, () => true);
}

export function listPresets(signal?: AbortSignal): Promise<MapsResponse<MapPreset[]>> {
  return request("GET", "/maps/presets", parsePresets, { signal });
}

export function findGeofabrik(
  bbox: Bbox,
  signal?: AbortSignal
): Promise<MapsResponse<GeofabrikLookupResponse>> {
  return request("GET", `/maps/geofabrik?bbox=${bbox.join(",")}`, parseGeofabrikLookup, {
    signal,
  });
}

export function listGeofabrikOutlines(
  signal?: AbortSignal
): Promise<MapsResponse<GeofabrikOutlinesResponse>> {
  // The first call may wait for the server to fetch Geofabrik's index.
  return request("GET", "/maps/geofabrik/regions", parseGeofabrikOutlines, {
    signal,
    timeout: 60_000,
  });
}

export function geocode(q: string, signal?: AbortSignal): Promise<MapsResponse<GeocodeResponse>> {
  return request("GET", `/maps/geocode?q=${enc(q)}`, parseGeocode, { signal });
}

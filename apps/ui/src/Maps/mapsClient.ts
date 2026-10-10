import type { MapActivateResponse, MapMeta } from "@moveet/shared-types";
import { config } from "@/utils/config";

/**
 * Every call the Maps panel makes, and every payload it reads, in one place.
 *
 * The library half (`GET /maps`, activate, delete) is the simulator's settled
 * API. The build half (`POST /maps`, `/maps/jobs`, `/maps/presets`,
 * `/maps/geofabrik`, `/maps/geocode` and the job progress WebSocket frames) is
 * newer and may be missing on an older simulator, so each parser here is
 * lenient: it accepts the documented shape plus the obvious alternatives
 * (bare array vs `{ items }` envelope, `{ id }` vs a full job) and normalizes
 * them, so the rest of the UI only ever sees the types below. Reconciling with
 * a changed server shape is a change to this file alone.
 *
 * Calls never throw. They resolve to a `MapsResponse` carrying the HTTP status,
 * because the panel acts on it: 404 on `/maps/presets` means builds are not
 * supported, 429 on `/maps/geocode` means "slow down", 409 means "busy".
 */

/** `[west, south, east, north]` in degrees. */
export type Bbox = [number, number, number, number];

export type MapsResponse<T> =
  | { ok: true; status: number; data: T }
  /** `status` is 0 when the request never got an HTTP answer. */
  | { ok: false; status: number; error: string };

/** Caps the server applies to a build. Each is null when the server does not say. */
export interface MapBuildLimits {
  maxAreaKm2: number | null;
  diskQuotaBytes: number | null;
  diskUsedBytes: number | null;
}

export interface MapLibrary {
  maps: MapMeta[];
  activeId: string;
  switching: boolean;
  /** Null when the server predates map builds (no `buildsAllowed` field). */
  builds: { allowed: boolean; limits: MapBuildLimits } | null;
}

export type MapJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface MapJob {
  id: string;
  status: MapJobStatus;
  /** Free-form step name from the server (`download`, `extract`, ...). */
  step: string;
  /** Overall progress, 0..1. */
  progress: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
  /** Library id of the built map, once done. */
  mapId?: string;
  label?: string;
  activate?: boolean;
  createdAt?: string;
}

export interface MapPreset {
  name: string;
  label: string;
  bbox: Bbox;
  geofabrik?: string;
  areaKm2?: number;
}

export interface GeofabrikRegion {
  path: string;
  name: string;
  /** Download size of the extract, when the server knows it. */
  sizeBytes?: number;
}

export interface GeocodeCandidate {
  name: string;
  bbox: Bbox;
  type?: string;
}

export interface GeocodeResult {
  candidates: GeocodeCandidate[];
  /** Licence notice to show next to the results. */
  attribution?: string;
}

export type MapBuildRequest = {
  buildings?: boolean;
  activate?: boolean;
} & ({ preset: string; label?: string } | { label: string; bbox: Bbox; geofabrik: string });

export interface MapBuildAccepted {
  id: string;
  /** The job as the server reported it, when it sent more than the id. */
  job?: MapJob;
}

/**
 * WebSocket message types that may carry map build progress. The server
 * announces jobs on one of these; listening on both costs nothing.
 */
export const MAP_JOB_WS_TYPES = ["mapjob", "map:job"] as const;

// ─── Parsing ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function parseBbox(v: unknown): Bbox | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map((x) => (typeof x === "string" ? Number(x) : x));
  if (!n.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  return n as Bbox;
}

/** A list either bare or wrapped as `{ [key]: [...] }`. */
function listOf(body: unknown, key: string): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (isObj(body) && Array.isArray(body[key])) return body[key] as unknown[];
  return null;
}

function parseLimits(body: Obj): MapBuildLimits {
  const raw = [body.buildLimits, body.limits, body.caps].find(isObj) ?? body;
  return {
    maxAreaKm2: num(raw.maxAreaKm2) ?? num(raw.maxBboxAreaKm2) ?? null,
    diskQuotaBytes: num(raw.diskQuotaBytes) ?? null,
    diskUsedBytes: num(raw.diskUsedBytes) ?? null,
  };
}

export function parseMapList(body: unknown): MapLibrary | null {
  if (!isObj(body) || !Array.isArray(body.maps)) return null;
  const maps = body.maps.filter(
    (m): m is MapMeta => isObj(m) && typeof m.id === "string" && typeof m.label === "string"
  );
  return {
    maps,
    activeId: typeof body.activeId === "string" ? body.activeId : "",
    switching: body.switching === true,
    builds:
      typeof body.buildsAllowed === "boolean"
        ? { allowed: body.buildsAllowed, limits: parseLimits(body) }
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

export function parseMapJob(v: unknown): MapJob | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  if (typeof v.status !== "string" || !JOB_STATUSES.has(v.status)) return null;
  const progress = num(v.progress) ?? 0;
  return {
    id: v.id,
    status: v.status as MapJobStatus,
    step: str(v.step) ?? v.status,
    progress: Math.min(1, Math.max(0, progress)),
    bytesDownloaded: num(v.bytesDownloaded),
    totalBytes: num(v.totalBytes),
    error: str(v.error),
    mapId: str(v.mapId),
    label: str(v.label),
    activate: typeof v.activate === "boolean" ? v.activate : undefined,
    createdAt: str(v.createdAt),
  };
}

export function parseMapJobs(body: unknown): MapJob[] {
  const list = listOf(body, "jobs") ?? [];
  return list.map(parseMapJob).filter((j): j is MapJob => j !== null);
}

/** A job progress WebSocket frame's `data`, or null when it is not one. */
export function parseMapJobMessage(data: unknown): MapJob | null {
  // Tolerate a frame that wraps the job (`{ job: {...} }`).
  if (isObj(data) && isObj(data.job)) return parseMapJob(data.job);
  return parseMapJob(data);
}

export function parseBuildAccepted(body: unknown): MapBuildAccepted | null {
  if (!isObj(body)) return null;
  const job = parseMapJob(body);
  if (job) return { id: job.id, job };
  if (typeof body.id === "string") return { id: body.id };
  if (typeof body.jobId === "string") return { id: body.jobId };
  return null;
}

export function parsePresets(body: unknown): MapPreset[] {
  const list = listOf(body, "presets") ?? [];
  const out: MapPreset[] = [];
  for (const p of list) {
    if (!isObj(p)) continue;
    const bbox = parseBbox(p.bbox);
    const name = str(p.name) ?? str(p.id);
    if (!bbox || !name) continue;
    out.push({
      name,
      label: str(p.label) ?? name,
      bbox,
      geofabrik: str(p.geofabrik),
      areaKm2: num(p.areaKm2),
    });
  }
  return out;
}

export function parseGeofabrik(body: unknown): GeofabrikRegion[] {
  const list = listOf(body, "regions") ?? [];
  const out: GeofabrikRegion[] = [];
  for (const r of list) {
    if (!isObj(r)) continue;
    const path = str(r.path);
    if (!path) continue;
    out.push({
      path,
      name: str(r.name) ?? path,
      sizeBytes: num(r.sizeBytes) ?? num(r.size) ?? num(r.bytes),
    });
  }
  return out;
}

export function parseGeocode(body: unknown): GeocodeResult {
  const list = listOf(body, "results") ?? [];
  const candidates: GeocodeCandidate[] = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const bbox = parseBbox(c.bbox);
    const name = str(c.name) ?? str(c.displayName);
    if (!bbox || !name) continue;
    candidates.push({ name, bbox, type: str(c.type) });
  }
  return {
    candidates,
    attribution: isObj(body) ? str(body.attribution) : undefined,
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
  return request("POST", "/maps", parseBuildAccepted, { body: req });
}

export function listMapJobs(signal?: AbortSignal): Promise<MapsResponse<MapJob[]>> {
  return request("GET", "/maps/jobs", (b) => (listOf(b, "jobs") ? parseMapJobs(b) : null), {
    signal,
  });
}

export function getMapJob(id: string): Promise<MapsResponse<MapJob>> {
  return request("GET", `/maps/jobs/${enc(id)}`, parseMapJob);
}

export function cancelMapJob(id: string): Promise<MapsResponse<true>> {
  return request("DELETE", `/maps/jobs/${enc(id)}`, () => true);
}

export function listPresets(signal?: AbortSignal): Promise<MapsResponse<MapPreset[]>> {
  return request("GET", "/maps/presets", (b) => (listOf(b, "presets") ? parsePresets(b) : null), {
    signal,
  });
}

export function findGeofabrik(
  bbox: Bbox,
  signal?: AbortSignal
): Promise<MapsResponse<GeofabrikRegion[]>> {
  return request(
    "GET",
    `/maps/geofabrik?bbox=${bbox.join(",")}`,
    (b) => (listOf(b, "regions") ? parseGeofabrik(b) : null),
    { signal }
  );
}

export function geocode(q: string, signal?: AbortSignal): Promise<MapsResponse<GeocodeResult>> {
  return request("GET", `/maps/geocode?q=${enc(q)}`, parseGeocode, { signal });
}

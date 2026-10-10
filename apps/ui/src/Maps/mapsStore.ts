import { useEffect, useSyncExternalStore } from "react";
import type { MapMeta } from "@moveet/shared-types";
import { toast } from "@/lib/toast";
import client from "@/utils/client";
import type { MapStatusPayload } from "@/utils/wsTypes";
import {
  activateMap,
  buildMap,
  cancelMapJob,
  deleteMap,
  listMapJobs,
  listMaps,
  listPresets,
  parseMapJob,
  type MapBuildRequest,
  type MapJob,
  type MapLibrary,
  type MapPreset,
  type MapsResponse,
} from "./mapsClient";

/**
 * The map library as the UI knows it, kept outside the panel so that a build
 * started from the panel keeps reporting after the panel closes, and a switch
 * announced on the `map` channel gets its toast whichever view is open.
 * `useMapsSync` (mounted once, at the app root) feeds it; the panel reads it
 * with `useMapsState` and changes it through the actions below.
 */

/**
 * What the server lets this UI do about new maps:
 * - `unknown`: not asked yet;
 * - `unsupported`: the server has no build endpoints (an older simulator);
 * - `disabled`: it has them, but builds are switched off;
 * - `enabled`: the New map flow is available.
 */
export type BuildSupport = "unknown" | "unsupported" | "disabled" | "enabled";

export interface MapsState {
  library: MapLibrary | null;
  loading: boolean;
  error: string | null;
  buildSupport: BuildSupport;
  presets: MapPreset[];
  jobs: MapJob[];
  /** A swap in progress: the map being switched to, when known. */
  switching: { id: string; label: string } | null;
  /** Id of the map with an activate or delete request in flight. */
  pending: string | null;
  /** The adapter warning from the last switch, until dismissed. */
  warning: string | null;
}

const INITIAL: MapsState = {
  library: null,
  loading: false,
  error: null,
  buildSupport: "unknown",
  presets: [],
  jobs: [],
  switching: null,
  pending: null,
  warning: null,
};

let state: MapsState = INITIAL;
const listeners = new Set<() => void>();
let presetsLoaded = false;

function update(patch: Partial<MapsState> | ((s: MapsState) => Partial<MapsState>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMapsState(): MapsState {
  return state;
}

export function useMapsState(): MapsState {
  return useSyncExternalStore(subscribe, getMapsState, getMapsState);
}

/** Test hook: back to a fresh store. */
export function resetMapsStore(): void {
  state = INITIAL;
  jobStatusSeen.clear();
  localSwitch = false;
  presetsLoaded = false;
}

// ─── Jobs ────────────────────────────────────────────────────────────

export function isJobActive(job: MapJob): boolean {
  return job.status === "queued" || job.status === "running";
}

/**
 * Last status seen per job, so a toast fires once per transition into a
 * terminal state whether the news came over the WebSocket or a reload of
 * `/maps/jobs`, and never
 * for jobs that had already finished when the page loaded.
 */
const jobStatusSeen = new Map<string, MapJob["status"]>();

function jobName(job: MapJob): string {
  return job.label || job.mapId || "map";
}

function noteJob(job: MapJob): void {
  const prev = jobStatusSeen.get(job.id);
  jobStatusSeen.set(job.id, job.status);
  if (prev !== "queued" && prev !== "running") return;
  if (job.status === "done") {
    toast.success(`Built ${jobName(job)}`);
    // Built, but `activate: true` could not switch to it.
    if (job.error) toast.info(`${jobName(job)} was built but not switched to: ${job.error}`);
    void refreshLibrary();
  } else if (job.status === "failed") {
    toast.error(`Building ${jobName(job)} failed${job.error ? `: ${job.error}` : ""}`);
  } else if (job.status === "cancelled") {
    toast.info(`Cancelled ${jobName(job)}`);
  }
}

/** Newest first; the server's order is creation order. */
function sortJobs(jobs: MapJob[]): MapJob[] {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function upsertJob(job: MapJob): void {
  noteJob(job);
  update((s) => {
    const others = s.jobs.filter((j) => j.id !== job.id);
    return { jobs: sortJobs([job, ...others]) };
  });
}

/** Feed a `mapjob` WebSocket frame into the store. */
export function handleMapJobFrame(data: MapJob): void {
  const job = parseMapJob(data);
  if (job) upsertJob(job);
}

export async function refreshJobs(): Promise<void> {
  const res = await listMapJobs();
  if (!res.ok) return;
  for (const job of res.data) {
    const prev = jobStatusSeen.get(job.id);
    // Seed without toasting: these are news only if we saw them active.
    if (prev === undefined) jobStatusSeen.set(job.id, job.status);
    else noteJob(job);
  }
  update({ jobs: sortJobs(res.data) });
}

export async function startBuild(req: MapBuildRequest): Promise<MapsResponse<MapJob>> {
  const res = await buildMap(req);
  if (res.ok) {
    const job = res.data;
    // Its `mapjob` frames may already have arrived; never step it backwards.
    if (!jobStatusSeen.has(job.id)) {
      jobStatusSeen.set(job.id, job.status);
      update((s) => ({ jobs: sortJobs([job, ...s.jobs]) }));
    }
    toast.info("Map build started");
  }
  return res;
}

export async function cancelJob(id: string): Promise<void> {
  const res = await cancelMapJob(id);
  if (!res.ok) toast.error(`Could not cancel the build: ${res.error}`);
  await refreshJobs();
}

// ─── Library ─────────────────────────────────────────────────────────

/**
 * Load the library, and on the first successful load work out whether this
 * server builds maps at all (the `buildsAllowed` field, then `/maps/presets`).
 */
export async function refreshLibrary(): Promise<void> {
  update({ loading: true });
  const res = await listMaps();
  if (!res.ok) {
    update({ loading: false, error: res.error });
    return;
  }
  const library = res.data;
  update((s) => ({
    library,
    loading: false,
    error: null,
    // The server is the authority on whether a swap is running; keep the
    // target we already know about when it agrees.
    switching: library.switching ? (s.switching ?? { id: "", label: "" }) : null,
  }));

  if (!library.builds) {
    update({ buildSupport: "unsupported" });
    return;
  }
  if (!presetsLoaded) {
    const presets = await listPresets();
    if (!presets.ok && presets.status === 404) {
      update({ buildSupport: "unsupported" });
      return;
    }
    presetsLoaded = presets.ok;
    if (presets.ok) update({ presets: presets.data });
    void refreshJobs();
  }
  update({ buildSupport: library.builds.allowed ? "enabled" : "disabled" });
}

/**
 * Set while this tab's own activate request is in flight: its response says
 * how the switch went, so the `map` frames for it must not toast a second time.
 */
let localSwitch = false;

function labelOf(id: string): string {
  return state.library?.maps.find((m) => m.id === id)?.label ?? id;
}

export async function activate(id: string): Promise<void> {
  if (state.pending || state.switching) return;
  localSwitch = true;
  update({ pending: id, switching: { id, label: labelOf(id) }, warning: null });
  const res = await activateMap(id);
  localSwitch = false;
  update({ pending: null, switching: null });
  if (res.ok) {
    if (res.data.changed) toast.success(`Switched to ${res.data.map.label}`);
    else toast.info(`${res.data.map.label} is already active`);
    if (res.data.warning) {
      update({ warning: res.data.warning });
      toast.info(res.data.warning, { duration: 10_000 });
    }
  } else {
    toast.error(`Could not switch to ${labelOf(id)}: ${res.error}`);
  }
  await refreshLibrary();
}

export async function remove(id: string): Promise<void> {
  if (state.pending || state.switching) return;
  const label = labelOf(id);
  update({ pending: id });
  const res = await deleteMap(id);
  update({ pending: null });
  if (res.ok) toast.success(`Deleted ${label}`);
  else toast.error(`Could not delete ${label}: ${res.error}`);
  await refreshLibrary();
}

export function dismissWarning(): void {
  update({ warning: null });
}

/** Feed a `map` WebSocket frame into the store. */
export function handleMapFrame(payload: MapStatusPayload): void {
  const map: MapMeta | undefined = payload.map;
  if (payload.status === "switching") {
    update({ switching: { id: map?.id ?? "", label: map?.label ?? "" } });
    return;
  }
  const was = state.switching;
  if (!localSwitch) {
    update({ switching: null });
    if (payload.status === "active" && was && map) {
      toast.success(`Switched to ${map.label}`);
    } else if (payload.status === "error") {
      const target = was?.label || "the new map";
      toast.error(`Could not switch to ${target}${payload.error ? `: ${payload.error}` : ""}`);
    }
  }
  if (payload.status === "active" && state.library && state.library.activeId !== map?.id) {
    void refreshLibrary();
  }
}

// ─── Sync hook ───────────────────────────────────────────────────────

/**
 * Catch up after the socket (re)connects: frames sent while it was down are
 * lost, so the library and the job list are read again.
 */
async function resync(): Promise<void> {
  await refreshLibrary();
  if (state.buildSupport === "enabled" || state.buildSupport === "disabled") {
    await refreshJobs();
  }
}

/**
 * Keeps the store current for the whole session. Mount once, at the app root:
 * loads the library and the job list, follows the `map` and `mapjob` channels,
 * and reads both again after a reconnect. No polling: live frames carry
 * progress, and a page reload starts from `/maps/jobs`.
 *
 * It reads no state itself, so the host (App) never re-renders for it.
 */
export function useMapsSync(): void {
  useEffect(() => {
    void refreshLibrary();
    const onConnect = () => void resync();
    client.onMap(handleMapFrame);
    client.onMapJob(handleMapJobFrame);
    client.onConnect(onConnect);
    return () => {
      client.offMap(handleMapFrame);
      client.offMapJob(handleMapJobFrame);
      client.offConnect(onConnect);
    };
  }, []);
}

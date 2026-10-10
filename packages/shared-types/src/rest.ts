// ─── REST Response Contract for Moveet ──────────────────────────────
// Shared response/request DTO shapes for the simulator's REST endpoints.
// The UI's client.ts imports these so a changed payload shape fails to
// compile on the consumer side rather than drifting silently.

import type { AnalyticsSummary, DirectionResult, FleetAnalytics, Position } from "./index";

// ─── Road network (/network, /roads) ────────────────────────────────

export interface RoadFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: Position[];
  };
  properties: {
    name?: string;
    type?: string;
    speed_limit?: number;
    highway?: string;
    streetId?: string;
    "@id"?: string;
  };
}

export interface RoadNetworkResponse {
  type: "FeatureCollection";
  features: RoadFeature[];
}

// ─── Directions (/direction batch response) ─────────────────────────

export interface DirectionResponse {
  status: string;
  results: DirectionResult[];
}

// ─── Historical generation (/recording/generate*) ───────────────────

export interface GenerateRecordingRequest {
  /** Historical start time as an ISO 8601 string. */
  startTime: string;
  hours: number;
  vehicleCount: number;
  /** Sim-ms advanced per step. */
  stepMs: number;
  seed?: number;
}

export interface GenerateAcceptedResponse {
  status: "generating";
  jobId: string;
}

export interface GenerateStatus {
  state: "idle" | "running" | "done" | "error";
  jobId?: string;
  step?: number;
  totalSteps?: number;
  pct?: number;
}

// ─── Scenarios (/scenarios*) ────────────────────────────────────────

export interface ScenarioSummary {
  name: string;
  duration: number;
  eventCount: number;
}

export interface ScenarioFile {
  fileName: string;
  fileSize: number;
  modifiedAt: string;
}

export interface ScenarioLoadResponse {
  status: string;
  scenario: ScenarioSummary;
}

export interface ScenarioStatus {
  state: "idle" | "running" | "paused";
  scenario: ScenarioSummary | null;
  elapsed: number;
  eventIndex: number;
  eventsExecuted: number;
  upcomingEvents: Array<{ at: number; type: string }>;
}

// ─── Analytics history (/analytics/history) ─────────────────────────
//
// The simulator writes these rows, shapes them (limit + server-side bucketing)
// and serves them; the UI plots them. They live here rather than in the
// simulator because a consumer that hand-copies an aggregation contract is a
// consumer that will eventually read a cumulative counter as an average.

/** Sort order of the rows in an analytics history payload. */
export type AnalyticsOrder = "asc" | "desc";

/** Provenance of a single downsampled row. */
export interface AnalyticsBucketInfo {
  /** Bucket width in milliseconds. */
  durationMs: number;
  /** Canonical width label, e.g. `"5m"`. */
  label: string;
  /** ISO start of the bucket window (inclusive). */
  start: string;
  /** ISO end of the bucket window (exclusive). */
  end: string;
  /** Stored samples folded into this row. */
  sampleCount: number;
  /** ISO timestamp of the oldest sample folded in. */
  firstTimestamp: string;
  /** ISO timestamp of the newest sample folded in. */
  lastTimestamp: string;
}

/**
 * How each analytics field is folded when a query is bucketed.
 *
 * The distinction matters: `totalDistanceTraveled` and `totalIdleTime` are
 * monotonically accumulating counters — averaging them would understate the
 * fleet and break monotonicity, so the bucket keeps the LAST value. Gauges
 * (`activeVehicles`, `avgSpeed`, `avgRouteEfficiency`) are averaged across the
 * samples in the bucket. `totalVehicles` is a slow-moving gauge (fleet size),
 * so the last value is the honest representative rather than a fractional mean.
 *
 * `fleets[].vehicles` (the per-vehicle `VehicleStats[]`) is NOT aggregated: it
 * is a point-in-time array mixing cumulative counters with per-vehicle gauges
 * and there is no meaningful element-wise fold, so the newest sample's array is
 * carried through verbatim.
 *
 * Shipped inside the response metadata so a caller can never mistake a bucketed
 * counter for a mean — and shared with the UI so its axis labels are derived
 * from this map rather than restating it.
 */
export const ANALYTICS_BUCKET_AGGREGATION = {
  "summary.totalVehicles": "last",
  "summary.activeVehicles": "mean",
  "summary.totalDistanceTraveled": "last (cumulative counter)",
  "summary.avgSpeed": "mean",
  "summary.totalIdleTime": "last (cumulative counter)",
  "summary.avgRouteEfficiency": "mean",
  "summary.timestamp": "bucket start",
  "fleets[].vehicleCount": "last",
  "fleets[].activeCount": "mean",
  "fleets[].totalDistance": "last (cumulative counter)",
  "fleets[].avgSpeed": "mean",
  "fleets[].totalIdleTime": "last (cumulative counter)",
  "fleets[].routeEfficiency": "mean",
  "fleets[].vehicles": "last (not aggregated)",
} as const;

/** Dotted field paths {@link ANALYTICS_BUCKET_AGGREGATION} describes. */
export type AnalyticsAggregatedField = keyof typeof ANALYTICS_BUCKET_AGGREGATION;

/** Bucket summary attached to the metadata of a downsampled query. */
export interface AnalyticsBucketMeta {
  durationMs: number;
  label: string;
  /** Buckets in the payload. */
  count: number;
  /** Stored samples folded into those buckets. */
  sampleCount: number;
  /** True when the width was derived from the data rather than requested. */
  auto: boolean;
  aggregation: typeof ANALYTICS_BUCKET_AGGREGATION;
}

/** One row of the simulator's `analytics_history` table. */
export interface AnalyticsHistoryRow {
  id: number;
  /** ISO-8601 row timestamp. On a bucketed row, the bucket start. */
  timestamp: string;
  summary: AnalyticsSummary;
  fleets: FleetAnalytics[];
  /**
   * Present only on downsampled rows. Its absence means the row is a verbatim
   * stored sample.
   */
  bucket?: AnalyticsBucketInfo;
}

/**
 * Everything the caller needs to know about what the query did NOT return.
 *
 * A limited query is answered from the RECENT end of the window, so anything
 * omitted is always older than the payload.
 */
export interface AnalyticsHistoryMeta {
  /** Stored rows inside the requested window, before limiting or bucketing. */
  matched: number;
  /** Stored rows actually read (and therefore represented in the payload). */
  scanned: number;
  /** Entries in the payload (buckets when bucketed, rows otherwise). */
  returned: number;
  /** Stored rows in the window that are NOT represented at all. */
  omitted: number;
  /** True whenever `omitted > 0` — i.e. the payload is not the whole window. */
  truncated: boolean;
  /** Which end of the window survives the limit. Always the newest. */
  anchor: "newest";
  /** Limit actually applied after clamping to [1, 10000]. */
  limit: number;
  order: AnalyticsOrder;
  /** Echo of the requested window (`null` = unbounded). */
  from: string | null;
  to: string | null;
  /** Span the payload actually covers (`null` when empty). */
  coveredFrom: string | null;
  coveredTo: string | null;
  /** Oldest/newest stored timestamps inside the requested window. */
  windowFrom: string | null;
  windowTo: string | null;
  bucket: AnalyticsBucketMeta | null;
}

/** Body shape returned by `?envelope=true`. */
export interface AnalyticsHistoryEnvelope {
  meta: AnalyticsHistoryMeta | null;
  rows: AnalyticsHistoryRow[];
}

/**
 * Either body the endpoint can answer with. Without `?envelope=true` it stays
 * a bare array, which is also what a simulator predating the bucketing work
 * returns — so a client that asks for the envelope must still tolerate this.
 */
export type AnalyticsHistoryPayload = AnalyticsHistoryRow[] | AnalyticsHistoryEnvelope;

// ─── Map library ────────────────────────────────────────────────────

/**
 * Where a library map came from. `import` is a file brought in from outside
 * the library (the pre-library `data/network.geojson`), `bundled` is the small
 * default shipped in the image, and `geofabrik`/`preset` are maps the
 * simulator built itself (`POST /maps`) from a Geofabrik extract, cut to
 * `bbox`. A `preset` build names its `regions.json` entry.
 */
export type MapSource =
  | { type: "geofabrik"; path: string; bbox?: [number, number, number, number] }
  | { type: "preset"; name: string; path?: string; bbox?: [number, number, number, number] }
  | { type: "import"; from: string }
  | { type: "bundled" };

/** A road network in the simulator's map library (`<MAPS_DIR>/<id>/meta.json`). */
export interface MapMeta {
  /** Directory name: lowercase letters, digits, `-` and `_`. */
  id: string;
  label: string;
  /** `[minLon, minLat, maxLon, maxLat]` of the road geometry, or null when empty. */
  bbox: [number, number, number, number] | null;
  source: MapSource;
  sizes: {
    /** Bytes of `network.geojson`. */
    networkBytes: number;
    /** Bytes of the `buildings/` tile tree, or 0 when the map has none. */
    buildingsBytes: number;
  };
  /** GeoJSON features in `network.geojson`. */
  featureCount: number;
  /** Graph nodes, known once the map has been loaded at least once. */
  nodeCount: number | null;
  /** Whether the map ships 3D building tiles. */
  hasBuildings: boolean;
  /** Buildings in the tile tree, when the simulator built the map. */
  buildingCount?: number;
  /** Data licence notice, e.g. OpenStreetMap's ODbL attribution. */
  attribution?: string;
  createdAt: string;
}

/** `GET /maps` */
export interface MapListResponse {
  maps: MapMeta[];
  activeId: string;
  /** True while a `POST /maps/:id/activate` is swapping the network. */
  switching: boolean;
  /** False when `ALLOW_MAP_BUILDS=false`: `POST /maps` and job cancellation answer 403. */
  buildsAllowed: boolean;
  buildLimits: MapBuildLimits;
}

/** Caps applied to `POST /maps`, so a client can check a request before sending it. */
export interface MapBuildLimits {
  /** Largest bbox a build accepts, in km². */
  maxAreaKm2: number;
  /** Disk budget for the library's maps (`MAP_BUILD_DISK_QUOTA_MB`), in bytes. */
  diskQuotaBytes: number;
  /** Bytes the library's maps use now (the download cache excluded). */
  diskUsedBytes: number;
  /** Bytes of cached Geofabrik downloads (`<MAPS_DIR>/.cache`). */
  cacheBytes: number;
  /** Jobs that may wait behind the running one; `POST /maps` answers 409 beyond that. */
  maxQueuedJobs: number;
}

// ─── Map builds ─────────────────────────────────────────────────────

/**
 * `POST /maps` body: a `regions.json` preset, or a custom area. A custom map
 * is cut to exactly `bbox`; `geofabrik` only names the extract downloaded to
 * cut it from.
 */
export type MapBuildRequest =
  | { preset: string; label?: string; buildings?: boolean; activate?: boolean }
  | {
      label: string;
      /** `[west, south, east, north]` in degrees. */
      bbox: [number, number, number, number];
      /**
       * Geofabrik extract path from `GET /maps/geofabrik`, e.g.
       * `europe/italy/nord-ovest`. Optional: when left out, the server picks
       * the smallest extract whose boundary contains the whole bbox.
       */
      geofabrik?: string;
      buildings?: boolean;
      activate?: boolean;
    };

export type MapJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type MapJobStep =
  | "queued"
  | "download"
  | "extract"
  | "filter"
  | "export"
  | "prune"
  | "validate"
  | "buildings"
  | "finalize"
  | "activate";

/**
 * A map build job. Also the payload of the `mapjob` WebSocket message, sent on
 * every state change and on progress.
 */
export interface MapJob {
  id: string;
  status: MapJobStatus;
  step: MapJobStep;
  /** Overall progress, 0..1. */
  progress: number;
  /** Download progress, while the Geofabrik extract is being fetched. */
  bytesDownloaded?: number;
  totalBytes?: number;
  /**
   * Why the job failed. On a `done` job it means the map was built but
   * `activate: true` could not switch to it.
   */
  error?: string;
  /** The library id of the built map, once `done`. */
  mapId?: string;
  label: string;
  bbox: [number, number, number, number];
  geofabrik: string;
  preset?: string;
  buildings: boolean;
  activate: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/** `POST /maps` (202): the job as it stands (`running` when nothing else was). */
export type MapBuildAccepted = MapJob;

/** `GET /maps/jobs` */
export interface MapJobListResponse {
  jobs: MapJob[];
}

/** One `GET /maps/presets` entry (`apps/network/regions.json`). */
export interface MapPreset {
  name: string;
  label: string;
  bbox: [number, number, number, number];
  geofabrik: string;
  /** Approximate area of the bbox, km². */
  areaKm2: number;
}

/** A Geofabrik extract whose boundary contains the requested bbox (`GET /maps/geofabrik`). */
export interface GeofabrikRegion {
  /** Extract path, the `geofabrik` value of `POST /maps`. */
  path: string;
  name: string;
  /** `[west, south, east, north]` of the extract's boundary. */
  bbox: [number, number, number, number];
  /** Approximate area of the extract's boundary, km²: the list is sorted by it, smallest first. */
  areaKm2: number;
  /** Download URL of the `.pbf`. */
  url: string;
  /** Path of the extract this one is part of (Geofabrik's hierarchy), if any. */
  parent?: string;
  /** Size of the `.pbf` download in bytes, when Geofabrik reported it. */
  sizeBytes?: number;
}

export interface GeofabrikLookupResponse {
  regions: GeofabrikRegion[];
  /**
   * Set when the bbox crosses a border between extracts: the smallest extract
   * under each part of the box (two or more). `regions[0]`, if any, is the
   * smallest extract that holds all of it, usually their common parent.
   */
  crosses?: { path: string; name: string }[];
}

/** One extract outline for the area picker (`GET /maps/geofabrik/regions`). */
export interface GeofabrikOutline {
  path: string;
  name: string;
  parent?: string;
  /** Depth in Geofabrik's hierarchy: 0 for a continent, 1 for a country, and so on. */
  depth: number;
  /** Simplified boundary as MultiPolygon coordinates (`[lon, lat]`, 3 decimals). */
  polygons: [number, number][][][];
}

export interface GeofabrikOutlinesResponse {
  regions: GeofabrikOutline[];
  /** Credit for the outlines (Geofabrik, from OpenStreetMap data). */
  attribution: string;
}

/** A place from `GET /maps/geocode` (Nominatim). */
export interface GeocodeResult {
  name: string;
  /** `[west, south, east, north]` */
  bbox: [number, number, number, number];
  /** `[lon, lat]` */
  center: [number, number];
  /** OSM class/type, e.g. `boundary/administrative`, `place/city`. */
  type: string;
  /**
   * The place's own boundary when OpenStreetMap has one (a city, a district),
   * simplified, as MultiPolygon coordinates (`[lon, lat]`). Absent for points.
   */
  outline?: [number, number][][][];
}

export interface GeocodeResponse {
  results: GeocodeResult[];
  /** Nominatim's licence notice, to show next to the results. */
  attribution: string;
}

/** `POST /maps/:id/activate` */
export interface MapActivateResponse {
  map: MapMeta;
  /** The map that was active before (the same id when nothing changed). */
  previousId: string;
  /** False when the requested map was already active. */
  changed: boolean;
  durationMs: number;
  /** Set when an external adapter is configured: its fleet now sits on a different city. */
  warning?: string;
}

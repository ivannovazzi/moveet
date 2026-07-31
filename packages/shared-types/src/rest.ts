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

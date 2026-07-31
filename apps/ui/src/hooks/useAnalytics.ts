import { useEffect, useMemo, useRef, useState } from "react";
import { downsample } from "@/components/charts";
import type { ApiResponse } from "@/types";
import { HttpClient } from "@/utils/httpClient";
import { config as appConfig } from "@/utils/config";
import {
  ANALYTICS_BUCKET_AGGREGATION,
  type AnalyticsBucketMeta,
  type AnalyticsHistoryMeta,
  type AnalyticsHistoryPayload,
  type AnalyticsHistoryRow,
} from "@moveet/shared-types";
import { analyticsStore, type AnalyticsSummary, type FleetAnalytics } from "./analyticsStore";

const POLL_INTERVAL_MS = 1000;

export interface UseAnalyticsResult {
  summary: AnalyticsSummary | null;
  fleetHistory: Map<string, FleetAnalytics[]>;
  summaryHistory: AnalyticsSummary[];
}

/**
 * Polls analyticsStore.getVersion() on a 1-second interval
 * and re-renders the component when the version changes.
 *
 * `version` is used intentionally as a dirty-check trigger in useMemo deps —
 * when the store version bumps, we re-derive from the store.
 */
export function useAnalytics(): UseAnalyticsResult {
  const lastVersionRef = useRef(-1);
  const [version, setVersion] = useState(() => analyticsStore.getVersion());

  useEffect(() => {
    const tick = () => {
      const current = analyticsStore.getVersion();
      if (current !== lastVersionRef.current) {
        lastVersionRef.current = current;
        setVersion(current);
      }
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive only when the store version bumps
  const summary = useMemo(() => analyticsStore.getSummary(), [version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive only when the store version bumps
  const summaryHistory = useMemo(() => analyticsStore.getSummaryHistory(), [version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive only when the store version bumps
  const fleetHistory = useMemo(() => {
    const map = new Map<string, FleetAnalytics[]>();
    for (const id of analyticsStore.getFleetIds()) {
      map.set(id, analyticsStore.getFleetHistory(id));
    }
    return map;
  }, [version]);

  return { summary, fleetHistory, summaryHistory };
}

// ─── Time-range analytics series ─────────────────────────────────────
//
// Two interchangeable sources feed the analytics charts:
//
//  • "live"      — the WebSocket window analyticsStore already keeps (the last
//                  60 snapshots, ~5 min at the simulator's 5 s cadence).
//  • "persisted" — GET /analytics/history, the simulator's SQLite
//                  `analytics_history` time series, which accepts
//                  from/to/limit plus `bucket` (server-side downsampling) and
//                  `envelope` (metadata in the body). It answers 503 when the
//                  simulator runs without persistence; that surfaces as an
//                  honest "unavailable" state rather than a silent fallback to
//                  a differently-scoped window.
//
// Both normalise to the same `{ summaries, fleetHistory }` shape so the panel
// (and its charts) never learn which source they are reading.

/** Selectable window. `"live"` is the in-memory WebSocket window. */
export type AnalyticsRange = "live" | "1h" | "6h" | "24h";

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = ["live", "1h", "6h", "24h"] as const;

const RANGE_MS: Record<Exclude<AnalyticsRange, "live">, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/** Samples kept for plotting — more than this is sub-pixel in a dock panel. */
const MAX_PLOT_POINTS = 240;

/**
 * Entries requested per query. The panel plots at most `MAX_PLOT_POINTS`, so
 * asking for more than that only pays to ship rows the charts thin away again.
 * Paired with `bucket=auto` the simulator fits the WHOLE window into this many
 * buckets instead of returning the newest N raw samples and nothing older.
 */
const HISTORY_ENTRY_LIMIT = MAX_PLOT_POINTS;

/**
 * Server-side downsample width. `auto` picks the smallest width off the
 * simulator's ladder that fits the queried span into `limit` buckets.
 */
const HISTORY_BUCKET = "auto";

const PERSISTED_REFRESH_MS = 15_000;

export interface AnalyticsHistoryQuery {
  /** ISO lower bound of the window. */
  from: string;
  /** Max entries — buckets, not raw samples, once `bucket` is set. */
  limit: number;
  /** Downsample width: `"auto"` or a duration such as `"30s"` / `"5m"`. */
  bucket: string;
}

export type AnalyticsHistoryFetcher = (
  params: AnalyticsHistoryQuery
) => Promise<ApiResponse<AnalyticsHistoryPayload>>;

let historyHttp: HttpClient | null = null;

/** Default fetcher. Injectable so the panel's source can be swapped in tests. */
export const fetchAnalyticsHistory: AnalyticsHistoryFetcher = ({ from, limit, bucket }) => {
  historyHttp ??= new HttpClient(appConfig.apiUrl);
  const query = new URLSearchParams({
    from,
    limit: String(limit),
    bucket,
    // Truncation and bucket facts ride in the body rather than in the
    // `X-Analytics-*` headers, because `HttpClient` hands back a parsed body
    // and nothing else.
    envelope: "true",
  });
  return historyHttp.get<AnalyticsHistoryPayload>(`/analytics/history?${query.toString()}`);
};

/**
 * Normalises both response bodies into rows plus (when present) metadata.
 *
 * A simulator without the bucketing endpoint ignores `envelope` and answers a
 * bare array; that path simply yields `meta: null`, and the panel degrades to
 * what it showed before rather than erroring.
 */
export function readHistoryPayload(payload: AnalyticsHistoryPayload | undefined | null): {
  rows: AnalyticsHistoryRow[];
  meta: AnalyticsHistoryMeta | null;
} {
  if (Array.isArray(payload)) return { rows: payload, meta: null };
  if (payload && Array.isArray(payload.rows)) {
    return { rows: payload.rows, meta: payload.meta ?? null };
  }
  return { rows: [], meta: null };
}

/** Plotted measures, keyed the way `AnalyticsSummary` keys them. */
export type BucketedMeasure =
  | "activeVehicles"
  | "avgSpeed"
  | "totalDistanceTraveled"
  | "totalIdleTime"
  | "avgRouteEfficiency";

/**
 * How the simulator folds each measure when a query is bucketed, DERIVED from
 * the shared `ANALYTICS_BUCKET_AGGREGATION` contract rather than restated —
 * the server's own descriptions ("last (cumulative counter)", "mean") narrowed
 * to the two cases the panel's copy distinguishes.
 *
 * The split matters: `totalDistanceTraveled` and `totalIdleTime` are
 * monotonically accumulating counters, so a bucket keeps their LAST value —
 * averaging them would understate the fleet. The rest are gauges and are
 * averaged. Presenting the two identically invites reading a counter as a mean,
 * so the panel labels them apart.
 */
export const BUCKET_AGGREGATION = Object.fromEntries(
  (
    [
      "activeVehicles",
      "avgSpeed",
      "totalDistanceTraveled",
      "totalIdleTime",
      "avgRouteEfficiency",
    ] as const
  ).map((measure) => [
    measure,
    ANALYTICS_BUCKET_AGGREGATION[`summary.${measure}`].startsWith("last") ? "last" : "mean",
  ])
) as Record<BucketedMeasure, "mean" | "last">;

/**
 * Hover copy explaining what one plotted point is. `undefined` when the series
 * is verbatim — there is nothing to disclaim about an unaggregated sample.
 */
export function describeAggregation(
  measure: BucketedMeasure,
  bucket: AnalyticsBucketMeta | null
): string | undefined {
  if (!bucket) return undefined;
  return BUCKET_AGGREGATION[measure] === "last"
    ? `Cumulative counter: each point is the last sample in its ${bucket.label} bucket, not an average.`
    : `Each point is the mean of the samples in its ${bucket.label} bucket.`;
}

export type AnalyticsSeriesStatus = "loading" | "collecting" | "ready" | "unavailable" | "error";

export interface AnalyticsSeriesResult {
  status: AnalyticsSeriesStatus;
  source: "live" | "persisted";
  /** Ascending by timestamp, thinned to at most `MAX_PLOT_POINTS`. */
  summaries: AnalyticsSummary[];
  fleetHistory: Map<string, FleetAnalytics[]>;
  latest: AnalyticsSummary | null;
  /** Human-readable reason for a non-ready status. */
  message: string | null;
  /** Server metadata for the persisted query. `null` for live/legacy sources. */
  meta: AnalyticsHistoryMeta | null;
  /**
   * True when the server left older samples out of the requested window. The
   * panel badges this rather than silently plotting a partial range.
   */
  truncated: boolean;
  /** Bucket the server aggregated into. `null` when the rows are verbatim. */
  bucket: AnalyticsBucketMeta | null;
}

/** Timestamp of a summary, falling back to the row's ISO timestamp. */
function frameTime(row: AnalyticsHistoryRow): number {
  const fromSummary = row.summary?.timestamp;
  if (Number.isFinite(fromSummary)) return fromSummary;
  const parsed = Date.parse(row.timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Fold persisted rows into the same shape the live store hands out. */
export function rowsToSeries(rows: AnalyticsHistoryRow[]): {
  summaries: AnalyticsSummary[];
  fleetHistory: Map<string, FleetAnalytics[]>;
} {
  const usable = rows.filter((row) => row?.summary && Number.isFinite(frameTime(row)));
  usable.sort((a, b) => frameTime(a) - frameTime(b));

  const summaries = usable.map((row) => ({ ...row.summary, timestamp: frameTime(row) }));

  const fleetHistory = new Map<string, FleetAnalytics[]>();
  for (const row of usable) {
    for (const fleet of row.fleets ?? []) {
      const existing = fleetHistory.get(fleet.fleetId);
      if (existing) existing.push(fleet);
      else fleetHistory.set(fleet.fleetId, [fleet]);
    }
  }

  return { summaries, fleetHistory };
}

function isPersistenceDisabled(error: string | undefined): boolean {
  return typeof error === "string" && error.includes("status 503");
}

export interface UseAnalyticsSeriesOptions {
  range: AnalyticsRange;
  /** Live window from `useAnalytics`. */
  summary: AnalyticsSummary | null;
  summaryHistory: AnalyticsSummary[];
  fleetHistory: Map<string, FleetAnalytics[]>;
  /** Swappable persisted-history source. */
  fetchHistory?: AnalyticsHistoryFetcher;
  /** Clock injection point for tests. */
  now?: () => number;
}

/**
 * Resolves the selected range to a plottable series.
 *
 * The persisted branch asks the simulator to bucket server-side into exactly as
 * many entries as the panel plots, so a 24 h window costs ~100 rows on the wire
 * instead of the 2 000-row slab this hook used to thin down itself. It
 * re-queries every 15 s so a long window keeps up with the running simulation,
 * and holds the previous rows while a refetch is in flight (no skeleton flash,
 * no layout jump).
 */
export function useAnalyticsSeries({
  range,
  summary,
  summaryHistory,
  fleetHistory,
  fetchHistory = fetchAnalyticsHistory,
  now = Date.now,
}: UseAnalyticsSeriesOptions): AnalyticsSeriesResult {
  const [rows, setRows] = useState<AnalyticsHistoryRow[] | null>(null);
  const [meta, setMeta] = useState<AnalyticsHistoryMeta | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<AnalyticsSeriesStatus>("loading");
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is a clock seam, not reactive state
  useEffect(() => {
    if (range === "live") return;

    let cancelled = false;
    setRows(null);
    setMeta(null);
    setRemoteStatus("loading");
    setRemoteMessage(null);

    const load = async () => {
      const from = new Date(now() - RANGE_MS[range]).toISOString();
      const response = await fetchHistory({
        from,
        limit: HISTORY_ENTRY_LIMIT,
        bucket: HISTORY_BUCKET,
      });
      if (cancelled) return;

      if (response.error || !response.data) {
        if (isPersistenceDisabled(response.error)) {
          setRemoteStatus("unavailable");
          setRemoteMessage(
            "The simulator is running without persistence, so there is no stored history to query."
          );
        } else {
          setRemoteStatus("error");
          setRemoteMessage(response.error ?? "Could not load analytics history.");
        }
        setRows([]);
        setMeta(null);
        return;
      }

      const payload = readHistoryPayload(response.data);
      setRows(payload.rows);
      setMeta(payload.meta);
      setRemoteStatus("ready");
      setRemoteMessage(null);
    };

    void load();
    const interval = setInterval(() => void load(), PERSISTED_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [range, fetchHistory]);

  return useMemo<AnalyticsSeriesResult>(() => {
    if (range === "live") {
      const ordered = summaryHistory.filter((s) => Number.isFinite(s?.timestamp));
      const status: AnalyticsSeriesStatus =
        ordered.length >= 2 ? "ready" : summary || ordered.length > 0 ? "collecting" : "loading";
      return {
        status,
        source: "live",
        summaries: downsample(ordered, MAX_PLOT_POINTS),
        fleetHistory,
        latest: summary ?? ordered[ordered.length - 1] ?? null,
        message:
          status === "loading"
            ? "Waiting for the first analytics snapshot from the simulator…"
            : status === "collecting"
              ? "Collecting samples — the trend appears once a second snapshot arrives."
              : null,
        meta: null,
        truncated: false,
        bucket: null,
      };
    }

    if (rows === null) {
      return {
        status: "loading",
        source: "persisted",
        summaries: [],
        fleetHistory: new Map(),
        latest: null,
        message: "Loading stored history…",
        meta: null,
        truncated: false,
        bucket: null,
      };
    }

    const derived = rowsToSeries(rows);
    const status: AnalyticsSeriesStatus =
      remoteStatus === "ready"
        ? derived.summaries.length >= 2
          ? "ready"
          : "collecting"
        : remoteStatus;

    return {
      status,
      source: "persisted",
      // The server already sized the payload to the plot; this stays as the
      // safety net for a legacy simulator that ignores `bucket` and for a
      // window whose bucket count overshoots.
      summaries: downsample(derived.summaries, MAX_PLOT_POINTS),
      fleetHistory: derived.fleetHistory,
      latest: derived.summaries[derived.summaries.length - 1] ?? null,
      message:
        status === "collecting" ? "No stored samples in this window yet." : (remoteMessage ?? null),
      meta,
      truncated: meta?.truncated ?? false,
      bucket: meta?.bucket ?? null,
    };
  }, [range, summary, summaryHistory, fleetHistory, rows, meta, remoteStatus, remoteMessage]);
}

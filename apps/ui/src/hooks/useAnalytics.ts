import { useEffect, useMemo, useRef, useState } from "react";
import { downsample } from "@/components/charts";
import type { ApiResponse } from "@/types";
import { HttpClient } from "@/utils/httpClient";
import { config as appConfig } from "@/utils/config";
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
//                  `analytics_history` time series, which already accepts
//                  from/to/limit. It answers 503 when the simulator runs
//                  without persistence; that surfaces as an honest
//                  "unavailable" state rather than a silent fallback to a
//                  differently-scoped window.
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

/** Rows requested per query. The simulator itself clamps at 10 000. */
const HISTORY_ROW_LIMIT = 2000;

/** Samples kept for plotting — more than this is sub-pixel in a dock panel. */
const MAX_PLOT_POINTS = 240;

const PERSISTED_REFRESH_MS = 15_000;

/** A row of the simulator's `analytics_history` table. */
export interface AnalyticsHistoryRow {
  id: number;
  /** ISO-8601 row timestamp. */
  timestamp: string;
  summary: AnalyticsSummary;
  fleets: FleetAnalytics[];
}

export type AnalyticsHistoryFetcher = (params: {
  from: string;
  limit: number;
}) => Promise<ApiResponse<AnalyticsHistoryRow[]>>;

let historyHttp: HttpClient | null = null;

/** Default fetcher. Injectable so the panel's source can be swapped in tests. */
export const fetchAnalyticsHistory: AnalyticsHistoryFetcher = ({ from, limit }) => {
  historyHttp ??= new HttpClient(appConfig.apiUrl);
  return historyHttp.get<AnalyticsHistoryRow[]>(
    `/analytics/history?from=${encodeURIComponent(from)}&limit=${limit}`
  );
};

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
 * The persisted branch re-queries every 15 s so a long window keeps up with the
 * running simulation, and holds the previous rows while a refetch is in flight
 * (no skeleton flash, no layout jump).
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
  const [remoteStatus, setRemoteStatus] = useState<AnalyticsSeriesStatus>("loading");
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is a clock seam, not reactive state
  useEffect(() => {
    if (range === "live") return;

    let cancelled = false;
    setRows(null);
    setRemoteStatus("loading");
    setRemoteMessage(null);

    const load = async () => {
      const from = new Date(now() - RANGE_MS[range]).toISOString();
      const response = await fetchHistory({ from, limit: HISTORY_ROW_LIMIT });
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
        return;
      }

      setRows(response.data);
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
      summaries: downsample(derived.summaries, MAX_PLOT_POINTS),
      fleetHistory: derived.fleetHistory,
      latest: derived.summaries[derived.summaries.length - 1] ?? null,
      message:
        status === "collecting" ? "No stored samples in this window yet." : (remoteMessage ?? null),
    };
  }, [range, summary, summaryHistory, fleetHistory, rows, remoteStatus, remoteMessage]);
}

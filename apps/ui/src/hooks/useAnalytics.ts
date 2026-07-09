import { useEffect, useRef, useState, useMemo } from "react";
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

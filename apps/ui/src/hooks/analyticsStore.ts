/**
 * Analytics store — single source of truth for fleet analytics data.
 *
 * Receives AnalyticsSnapshot messages from the simulator via WebSocket
 * every 5 seconds and maintains a rolling history of the last 60 snapshots.
 */

// ─── Analytics types ────────────────────────────────────────────────
// Re-exported from shared-types so the analytics contract has a single
// cross-service source of truth.

export type { AnalyticsSummary, FleetAnalytics, AnalyticsSnapshot } from "@moveet/shared-types";

import type { AnalyticsSummary, FleetAnalytics, AnalyticsSnapshot } from "@moveet/shared-types";

const MAX_HISTORY = 60;

class AnalyticsStore {
  private history: AnalyticsSnapshot[] = [];
  private currentSummary: AnalyticsSummary | null = null;
  private fleetHistory = new Map<string, FleetAnalytics[]>();
  private version = 0;

  /** Add a snapshot, trim to MAX_HISTORY entries. */
  push(snapshot: AnalyticsSnapshot): void {
    this.history.push(snapshot);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    this.currentSummary = snapshot.summary;

    for (const fleet of snapshot.fleets) {
      const existing = this.fleetHistory.get(fleet.fleetId) ?? [];
      existing.push(fleet);
      if (existing.length > MAX_HISTORY) {
        existing.shift();
      }
      this.fleetHistory.set(fleet.fleetId, existing);
    }

    this.version++;
  }

  getSummary(): AnalyticsSummary | null {
    return this.currentSummary;
  }

  getFleetHistory(fleetId: string): FleetAnalytics[] {
    return this.fleetHistory.get(fleetId) ?? [];
  }

  /** All fleet IDs that have history. */
  getFleetIds(): string[] {
    return Array.from(this.fleetHistory.keys());
  }

  /** Summary history for sparkline data. */
  getSummaryHistory(): AnalyticsSummary[] {
    return this.history.map((h) => h.summary);
  }

  getVersion(): number {
    return this.version;
  }

  /** Reset on reconnect. */
  clear(): void {
    this.history = [];
    this.currentSummary = null;
    this.fleetHistory.clear();
    this.version++;
  }
}

export const analyticsStore = new AnalyticsStore();

import type { ClientDeps } from "./types";
import type { ApiResponse, ClockState, TrafficEdge } from "@/types";
import type { AnalyticsSnapshot, AnalyticsSummary, FleetAnalytics } from "@/hooks/analyticsStore";

/** Simulation clock, traffic congestion, and analytics queries/streams. */
export class TelemetrySegment {
  constructor(private deps: ClientDeps) {
    this.getClock = this.getClock.bind(this);
    this.setClock = this.setClock.bind(this);
    this.onClock = this.onClock.bind(this);
    this.offClock = this.offClock.bind(this);
    this.getTraffic = this.getTraffic.bind(this);
    this.onTraffic = this.onTraffic.bind(this);
    this.offTraffic = this.offTraffic.bind(this);
    this.onAnalytics = this.onAnalytics.bind(this);
    this.offAnalytics = this.offAnalytics.bind(this);
    this.getAnalyticsSummary = this.getAnalyticsSummary.bind(this);
    this.getFleetAnalytics = this.getFleetAnalytics.bind(this);
    this.resetAnalytics = this.resetAnalytics.bind(this);
  }

  // ─── Simulation Clock ──────────────────────────────────────────

  async getClock(): Promise<ApiResponse<ClockState>> {
    return this.deps.http.get<ClockState>("/clock");
  }

  async setClock(params: {
    speedMultiplier?: number;
    setTime?: string;
  }): Promise<ApiResponse<ClockState>> {
    return this.deps.http.post<typeof params, ClockState>("/clock", params);
  }

  onClock(handler: (state: ClockState) => void): void {
    this.deps.ws.on("clock", handler);
  }

  offClock(handler?: (state: ClockState) => void): void {
    this.deps.ws.off("clock", handler);
  }

  // ─── Traffic Congestion ──────────────────────────────────────────

  async getTraffic(): Promise<ApiResponse<TrafficEdge[]>> {
    return this.deps.http.get<TrafficEdge[]>("/traffic");
  }

  onTraffic(handler: (data: TrafficEdge[]) => void): void {
    this.deps.ws.on("traffic", handler);
  }

  offTraffic(handler?: (data: TrafficEdge[]) => void): void {
    this.deps.ws.off("traffic", handler);
  }

  // ─── Analytics ────────────────────────────────────────────────────

  onAnalytics(handler: (data: AnalyticsSnapshot) => void): void {
    this.deps.ws.on("analytics", handler);
  }

  offAnalytics(handler?: (data: AnalyticsSnapshot) => void): void {
    this.deps.ws.off("analytics", handler);
  }

  async getAnalyticsSummary(): Promise<ApiResponse<AnalyticsSummary>> {
    return this.deps.http.get<AnalyticsSummary>("/analytics/summary");
  }

  async getFleetAnalytics(id: string): Promise<ApiResponse<FleetAnalytics>> {
    return this.deps.http.get<FleetAnalytics>(`/analytics/fleet/${id}`);
  }

  async resetAnalytics(): Promise<ApiResponse<{ ok: true }>> {
    return this.deps.http.post<undefined, { ok: true }>("/analytics/reset");
  }
}

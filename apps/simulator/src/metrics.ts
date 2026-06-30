import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";

/**
 * Central Prometheus metrics registry for the simulator process.
 *
 * The simulator is a single Express + WebSocket process, so a single
 * module-level registry singleton mirrors the codebase's module-singleton
 * style (one Registry, exposed at GET /metrics). Domain modules call the thin
 * increment/observe hooks exported below rather than importing prom-client
 * directly, keeping all collector definitions in one place.
 */
export const registry = new Registry();

// Default Node process metrics (event loop lag, heap, GC, handles, etc).
collectDefaultMetrics({ register: registry });

// ─── WebSocket metrics ──────────────────────────────────────────────────

/** Currently connected WebSocket clients (set from the broadcaster). */
const wsConnectedClients = new Gauge({
  name: "moveet_ws_connected_clients",
  help: "Number of currently connected WebSocket clients",
  registers: [registry],
});

/** Total WebSocket connections accepted over the process lifetime. */
const wsConnectionsTotal = new Counter({
  name: "moveet_ws_connections_total",
  help: "Total WebSocket connections accepted since process start",
  registers: [registry],
});

/** Clients terminated/closed because they fell behind (backpressure). */
const wsBackpressureDisconnectsTotal = new Counter({
  name: "moveet_ws_backpressure_disconnects_total",
  help: "WebSocket clients disconnected because they exceeded the dropped-flush limit (backpressure)",
  registers: [registry],
});

/** Flush cycles skipped for a client because its send buffer was over the backpressure threshold. */
const wsDroppedFlushesTotal = new Counter({
  name: "moveet_ws_dropped_flushes_total",
  help: "Total per-client flush cycles skipped due to backpressure",
  registers: [registry],
});

// ─── Adapter sync metrics ───────────────────────────────────────────────

/** Adapter sync attempts by outcome (success/failure). */
const adapterSyncTotal = new Counter({
  name: "moveet_adapter_sync_total",
  help: "Total adapter sync attempts by outcome",
  labelNames: ["result"] as const,
  registers: [registry],
});

/** Adapter sync attempt duration in seconds, labelled by outcome. */
const adapterSyncDurationSeconds = new Histogram({
  name: "moveet_adapter_sync_duration_seconds",
  help: "Duration of adapter sync attempts in seconds",
  labelNames: ["result"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ─── HTTP metrics ───────────────────────────────────────────────────────

/** HTTP request duration in seconds, labelled by method/route/status. */
const httpRequestDurationSeconds = new Histogram({
  name: "moveet_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ─── Thin hooks (called by domain modules) ──────────────────────────────

/** Sets the connected-client gauge to the current count. */
export function setWsConnectedClients(count: number): void {
  wsConnectedClients.set(count);
}

/** Records a newly accepted WebSocket connection and refreshes the gauge. */
export function recordWsConnection(currentCount: number): void {
  wsConnectionsTotal.inc();
  wsConnectedClients.set(currentCount);
}

/** Refreshes the gauge after a disconnect. */
export function recordWsDisconnection(currentCount: number): void {
  wsConnectedClients.set(currentCount);
}

/** Records a single client flush skipped due to backpressure. */
export function recordWsDroppedFlush(): void {
  wsDroppedFlushesTotal.inc();
}

/** Records a client terminated/closed because it exceeded the dropped-flush limit. */
export function recordWsBackpressureDisconnect(): void {
  wsBackpressureDisconnectsTotal.inc();
}

/** Records the outcome and duration of one adapter sync attempt. */
export function recordAdapterSync(result: "success" | "failure", durationSeconds: number): void {
  adapterSyncTotal.inc({ result });
  adapterSyncDurationSeconds.observe({ result }, durationSeconds);
}

/** Observes an HTTP request's duration with method/route/status labels. */
export function observeHttpRequest(
  method: string,
  route: string,
  status: number,
  durationSeconds: number
): void {
  httpRequestDurationSeconds.observe({ method, route, status: String(status) }, durationSeconds);
}

/** Returns the Prometheus text exposition for all registered metrics. */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/** The content type for the Prometheus text exposition format. */
export const metricsContentType = registry.contentType;

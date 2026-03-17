import type { ExportVehicle, VehicleUpdate, Fleet } from "../types";

export interface PluginConfig {
  [key: string]: unknown;
}

export interface ConfigField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "password" | "select";
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

/** Outcome of publishing a single item (vehicle update, chunk, etc.) within a sink. */
export interface SinkItemFailure {
  /** Identifier for the failed item (e.g. vehicle ID or chunk index). */
  itemId: string;
  error: string;
}

export interface SinkResult {
  type: string;
  success: boolean;
  error?: string;
  /** Per-item failures when the sink supports partial-failure reporting. */
  failures?: SinkItemFailure[];
  /** Total items attempted. */
  attempted?: number;
  /** Total items that succeeded. */
  succeeded?: number;
}

/** Result returned by sinks that support partial-failure reporting. */
export interface SinkPublishResult {
  attempted: number;
  succeeded: number;
  failures: SinkItemFailure[];
}

export interface PublishResult {
  status: "success" | "partial" | "failure";
  sinks: SinkResult[];
}

/**
 * Interface for data source plugins that provide vehicle data.
 *
 * ## Error handling contract
 *
 * All implementations MUST follow these rules:
 *
 * - **`connect()`** MUST throw on configuration errors (e.g. missing required
 *   fields such as `url`, `host`, credentials, etc.).
 *
 * - **`getVehicles()`** MUST throw when the source is not connected (i.e.
 *   `connect()` was never called or `disconnect()` was called). This allows
 *   `PluginManager` to distinguish a connection problem from genuinely empty
 *   data and mark the source as unhealthy.
 *
 * - **`getVehicles()`** MUST throw on network / query / auth errors so that
 *   callers can detect failures rather than silently receiving an empty array.
 *
 * - **`getVehicles()`** returns `[]` **only** when the upstream was
 *   successfully queried and the result set is genuinely empty.
 *
 * - **`healthCheck()`** MUST NOT throw. It returns a `HealthCheckResult` with
 *   `{ healthy: false, message }` on failure.
 */
export interface DataSource {
  readonly type: string;
  readonly name: string;
  readonly configSchema: ConfigField[];
  connect(config: PluginConfig): Promise<void>;
  disconnect(): Promise<void>;
  getVehicles(): Promise<ExportVehicle[]>;
  getFleets?(): Promise<Fleet[]>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface DataSink {
  readonly type: string;
  readonly name: string;
  readonly configSchema: ConfigField[];
  connect(config: PluginConfig): Promise<void>;
  disconnect(): Promise<void>;
  publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface PluginInfo {
  type: string;
  name: string;
  configSchema: ConfigField[];
}

export interface AdapterConfig {
  activeSource: string | null;
  activeSinks: string[];
  sourceConfig: Record<string, PluginConfig>;
  sinkConfig: Record<string, PluginConfig>;
}

export interface AdapterStatus {
  source: { type: string; healthy: boolean; message?: string } | null;
  sinks: Array<{ type: string; healthy: boolean; message?: string }>;
  availableSources: PluginInfo[];
  availableSinks: PluginInfo[];
}

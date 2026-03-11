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
}

export interface SinkResult {
  type: string;
  success: boolean;
  error?: string;
}

export interface PublishResult {
  status: "success" | "partial" | "failure";
  sinks: SinkResult[];
}

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
  publishUpdates(updates: VehicleUpdate[]): Promise<void>;
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

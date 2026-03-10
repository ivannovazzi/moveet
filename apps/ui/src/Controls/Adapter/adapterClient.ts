const BASE_URL = import.meta.env.VITE_ADAPTER_URL ?? "http://localhost:5011";

if (!import.meta.env.VITE_ADAPTER_URL && import.meta.env.PROD) {
  console.warn("VITE_ADAPTER_URL is not set — adapter requests will use http://localhost:5011");
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

export interface PluginInfo {
  type: string;
  configSchema: ConfigField[];
}

export interface HealthResponse {
  source: { type: string; healthy: boolean } | null;
  sinks: Array<{ type: string; healthy: boolean }>;
  availableSources: PluginInfo[];
  availableSinks: PluginInfo[];
}

export interface ConfigResponse {
  activeSource: string | null;
  activeSinks: string[];
  sourceConfig: Record<string, Record<string, unknown>>;
  sinkConfig: Record<string, Record<string, unknown>>;
  status: HealthResponse;
}

interface MutationResponse {
  ok: boolean;
  status: HealthResponse;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Adapter ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>("/config");
}

export function setSource(
  type: string,
  config?: Record<string, unknown>
): Promise<MutationResponse> {
  return request<MutationResponse>("/config/source", {
    method: "POST",
    body: JSON.stringify({ type, config }),
  });
}

export function addSink(type: string, config?: Record<string, unknown>): Promise<MutationResponse> {
  return request<MutationResponse>("/config/sinks", {
    method: "POST",
    body: JSON.stringify({ type, config }),
  });
}

export function removeSink(type: string): Promise<MutationResponse> {
  return request<MutationResponse>(`/config/sinks/${type}`, {
    method: "DELETE",
  });
}

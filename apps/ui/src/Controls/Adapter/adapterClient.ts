import { config } from "@/utils/config";

const BASE_URL = config.adapterUrl;

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
  realism?: RealismStatus;
}

export interface RealismStatus {
  enabled: boolean;
  devices: number;
  connected: number;
  degraded: number;
  disconnected: number;
  buffered: number;
}

export interface RealismBlock {
  config: Record<string, unknown>;
  schema: ConfigField[];
  status: RealismStatus;
}

export interface ConfigResponse {
  activeSource: string | null;
  activeSinks: string[];
  sourceConfig: Record<string, Record<string, unknown>>;
  sinkConfig: Record<string, Record<string, unknown>>;
  status: HealthResponse;
  realism?: RealismBlock;
}

interface MutationResponse {
  ok: boolean;
  status: HealthResponse;
}

const REQUEST_TIMEOUT = 10_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) throw new Error(`Adapter ${init?.method ?? "GET"} ${path}: ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Adapter ${path}: request timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

export function setRealism(
  config: Record<string, unknown>
): Promise<{ ok: boolean; realism: RealismBlock }> {
  return request<{ ok: boolean; realism: RealismBlock }>("/config/realism", {
    method: "POST",
    body: JSON.stringify({ config }),
  });
}

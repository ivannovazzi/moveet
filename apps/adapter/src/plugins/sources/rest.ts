import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle } from "../../types";
import { getNestedValue, fetchWithTimeout } from "../utils";

interface FieldMap {
  id: string;
  name: string;
  lat: string;
  lng: string;
}

const DEFAULT_FIELD_MAP: FieldMap = {
  id: "id",
  name: "name",
  lat: "lat",
  lng: "lng",
};

export class RestSource implements DataSource {
  readonly type = "rest";
  readonly name = "REST API";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    {
      name: "method",
      label: "Method",
      type: "select",
      options: [
        { label: "GET", value: "GET" },
        { label: "POST", value: "POST" },
      ],
    },
    { name: "headers", label: "Headers", type: "json" },
    { name: "body", label: "Body", type: "json" },
    { name: "vehiclePath", label: "Vehicle Path", type: "string", default: "vehicles" },
    { name: "fieldMap", label: "Field Map", type: "json" },
  ];
  private url: string | null = null;
  private headers: Record<string, string> = {};
  private method: "GET" | "POST" = "GET";
  private body: unknown = undefined;
  private vehiclePath: string = "vehicles";
  private fieldMap: FieldMap = { ...DEFAULT_FIELD_MAP };

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string;
    if (!url) throw new Error("REST source requires url");
    this.url = url;
    this.headers = (config.headers as Record<string, string>) || {};
    this.method = ((config.method as string) || "GET").toUpperCase() as "GET" | "POST";
    this.body = config.body;
    this.vehiclePath = (config.vehiclePath as string) || "vehicles";
    this.fieldMap = {
      ...DEFAULT_FIELD_MAP,
      ...((config.fieldMap as Partial<FieldMap>) || {}),
    };
  }

  async disconnect(): Promise<void> {
    this.url = null;
    this.headers = {};
    this.method = "GET";
    this.body = undefined;
    this.vehiclePath = "vehicles";
    this.fieldMap = { ...DEFAULT_FIELD_MAP };
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.url) return [];

    const fetchOptions: RequestInit = {
      method: this.method,
      headers: { "Content-Type": "application/json", ...this.headers },
    };

    if (this.method === "POST" && this.body !== undefined) {
      fetchOptions.body = JSON.stringify(this.body);
    }

    const response = await fetchWithTimeout(this.url, fetchOptions);
    if (!response.ok) {
      throw new Error(`REST source fetch failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const items = getNestedValue(json, this.vehiclePath);

    if (!Array.isArray(items)) {
      throw new Error(`Expected array at path "${this.vehiclePath}", got ${typeof items}`);
    }

    return items.flatMap((item: unknown) => {
      const record = item as Record<string, unknown>;
      const id = String(getNestedValue(record, this.fieldMap.id) ?? "");
      const name = String(getNestedValue(record, this.fieldMap.name) ?? id);
      const lat = Number(getNestedValue(record, this.fieldMap.lat));
      const lng = Number(getNestedValue(record, this.fieldMap.lng));

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn(`Skipping vehicle "${id}": invalid coordinates (lat=${lat}, lng=${lng})`);
        return [];
      }

      return [
        {
          id,
          name,
          position: [lat, lng] as [number, number],
        },
      ];
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.url) return { healthy: false, message: "not connected" };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(this.url, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeout);
      return res.ok ? { healthy: true } : { healthy: false, message: `HTTP ${res.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}

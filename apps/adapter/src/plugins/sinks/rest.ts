import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";
import { fetchWithTimeout } from "../utils";

export class RestSink implements DataSink {
  readonly type = "rest";
  readonly name = "REST API";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    {
      name: "method",
      label: "Method",
      type: "select",
      default: "POST",
      options: [
        { label: "POST", value: "POST" },
        { label: "PUT", value: "PUT" },
        { label: "PATCH", value: "PATCH" },
      ],
    },
    { name: "headers", label: "Headers", type: "json" },
    { name: "batchMode", label: "Batch Mode", type: "boolean", default: true },
  ];
  private url: string | null = null;
  private headers: Record<string, string> = {};
  private method: "POST" | "PUT" | "PATCH" = "POST";
  private batchMode: boolean = true;

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string;
    if (!url) throw new Error("REST sink requires url");
    this.url = url;
    this.headers = (config.headers as Record<string, string>) || {};
    this.method = ((config.method as string) || "POST").toUpperCase() as "POST" | "PUT" | "PATCH";
    this.batchMode = config.batchMode !== false;
  }

  async disconnect(): Promise<void> {
    this.url = null;
    this.headers = {};
    this.method = "POST";
    this.batchMode = true;
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (!this.url || updates.length === 0) return;

    const fetchOptions = {
      method: this.method,
      headers: { "Content-Type": "application/json", ...this.headers },
    };

    if (this.batchMode) {
      await fetchWithTimeout(this.url, {
        ...fetchOptions,
        body: JSON.stringify({ vehicles: updates }),
      });
    } else {
      await Promise.all(
        updates.map((update) =>
          fetchWithTimeout(this.url!, {
            ...fetchOptions,
            body: JSON.stringify(update),
          })
        )
      );
    }
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

import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";
import { fetchWithTimeout } from "../utils";

export class WebhookSink implements DataSink {
  readonly type = "webhook";
  readonly name = "Generic Webhook";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    { name: "headers", label: "Headers", type: "json" },
  ];
  private url: string | null = null;
  private headers: Record<string, string> = {};

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string;
    if (!url) throw new Error("Webhook sink requires url");
    this.url = url;
    this.headers = (config.headers as Record<string, string>) || {};
  }

  async disconnect(): Promise<void> {
    this.url = null;
    this.headers = {};
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (!this.url) return;

    await fetchWithTimeout(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({ vehicles: updates, timestamp: new Date().toISOString() }),
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

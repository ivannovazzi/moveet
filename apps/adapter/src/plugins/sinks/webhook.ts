import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";
import { httpFetch } from "../../utils/httpClient";

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
    if (!this.url) throw new Error("Webhook sink not connected");

    await httpFetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify({ vehicles: updates, timestamp: new Date().toISOString() }),
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.url) return { healthy: false, message: "not connected" };
    try {
      await httpFetch(this.url, { method: "HEAD" }, { timeoutMs: 3000, maxRetries: 1 });
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}

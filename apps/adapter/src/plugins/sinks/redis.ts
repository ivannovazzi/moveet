import Redis from "ioredis";
import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";

export class RedisPubSubSink implements DataSink {
  readonly type = "redis";
  readonly name = "Redis Pub/Sub";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", placeholder: "redis://localhost:6379" },
    { name: "host", label: "Host", type: "string", default: "localhost" },
    { name: "port", label: "Port", type: "number", default: 6379 },
    { name: "password", label: "Password", type: "password" },
    { name: "channel", label: "Channel", type: "string", default: "moveet:vehicle-updates" },
  ];
  private client: Redis | null = null;
  private channel = "moveet:vehicle-updates";

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string | undefined;
    const host = (config.host as string) || "localhost";
    const port = (config.port as number) || 6379;
    const password = config.password as string | undefined;
    this.channel = (config.channel as string) || "moveet:vehicle-updates";

    this.client = url ? new Redis(url) : new Redis({ host, port, password, lazyConnect: true });

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (!this.client) throw new Error("Redis sink not connected");

    const message = JSON.stringify({
      vehicles: updates,
      timestamp: new Date().toISOString(),
    });

    await this.client.publish(this.channel, message);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.client) return { healthy: false, message: "not connected" };
    try {
      const result = await this.client.ping();
      return result === "PONG"
        ? { healthy: true }
        : { healthy: false, message: `unexpected ping response: ${result}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}

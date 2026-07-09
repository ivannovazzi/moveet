import Redis, { type RedisOptions } from "ioredis";
import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";

/** Default connection timeout (ms). Overridable via `connectTimeoutMs` config. */
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export class RedisPubSubSink implements DataSink {
  readonly type = "redis";
  readonly name = "Redis Pub/Sub";
  readonly configSchema: ConfigField[] = [
    {
      name: "url",
      label: "URL",
      type: "string",
      placeholder: "redis://localhost:6379",
    },
    { name: "host", label: "Host", type: "string", default: "localhost" },
    { name: "port", label: "Port", type: "number", default: 6379 },
    { name: "password", label: "Password", type: "password" },
    {
      name: "channel",
      label: "Channel",
      type: "string",
      default: "moveet:vehicle-updates",
    },
    {
      name: "connectTimeoutMs",
      label: "Connect Timeout (ms)",
      type: "number",
      default: DEFAULT_CONNECT_TIMEOUT_MS,
      description: "Abort the connect attempt after this; prevents a hung connect on a dead host.",
    },
  ];
  private client: Redis | null = null;
  private channel = "moveet:vehicle-updates";

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string | undefined;
    const host = (config.host as string) || "localhost";
    const port = (config.port as number) || 6379;
    const password = config.password as string | undefined;
    this.channel = (config.channel as string) || "moveet:vehicle-updates";

    const rawTimeout =
      config.connectTimeoutMs != null
        ? Number(config.connectTimeoutMs)
        : DEFAULT_CONNECT_TIMEOUT_MS;
    const connectTimeout =
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_CONNECT_TIMEOUT_MS;

    // Bound connect/command behaviour so a dead broker fails fast instead of
    // ioredis retrying/reconnecting forever in the background:
    //  - connectTimeout caps the TCP connect attempt.
    //  - maxRetriesPerRequest: 1 means a command fails after one retry rather
    //    than queueing indefinitely while the connection is down.
    //  - retryStrategy returns null after a few attempts so a never-reachable
    //    host stops reconnecting (the manager's reconnect loop re-adds it).
    const resilience: RedisOptions = {
      connectTimeout,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    };

    this.client = url
      ? new Redis(url, { ...resilience, lazyConnect: true })
      : new Redis({ host, port, password, lazyConnect: true, ...resilience });

    try {
      await this.client.connect();
    } catch (err) {
      // Tear down the half-open client so its reconnect machinery doesn't leak —
      // connect() failing means the plugin is never stored in activeSinks, so
      // disconnect() would never be called otherwise (mirrors the redpanda sink).
      this.client.disconnect();
      this.client = null;
      throw err;
    }
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

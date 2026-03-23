import type {
  ConfigField,
  DataSink,
  HealthCheckResult,
  PluginConfig,
  SinkPublishResult,
} from "../types";
import type { VehicleUpdate } from "../../types";
import { httpFetch } from "../../utils/httpClient";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RestSink");

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

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (!this.url) throw new Error("REST sink not connected");
    if (updates.length === 0) return;

    const fetchOptions = {
      method: this.method,
      headers: { "Content-Type": "application/json", ...this.headers },
    };

    if (this.batchMode) {
      await httpFetch(this.url, {
        ...fetchOptions,
        body: JSON.stringify({ vehicles: updates }),
      });
      return;
    }

    // Non-batch mode: send individual requests per vehicle with partial failure handling
    const results = await Promise.allSettled(
      updates.map((update) =>
        httpFetch(this.url!, {
          ...fetchOptions,
          body: JSON.stringify(update),
        })
      )
    );

    const failures = results
      .map((result, i) => ({ result, update: updates[i] }))
      .filter(
        (entry): entry is { result: PromiseRejectedResult; update: VehicleUpdate } =>
          entry.result.status === "rejected"
      )
      .map(({ result, update }) => {
        const error =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        logger.error(
          { vehicleId: update.id, error },
          `Failed to publish update for vehicle ${update.id}`
        );
        return { itemId: update.id, error };
      });

    const succeeded = updates.length - failures.length;

    if (failures.length > 0 && succeeded === 0) {
      throw new Error(
        `All ${updates.length} vehicle updates failed. First error: ${failures[0].error}`
      );
    }

    if (failures.length > 0) {
      logger.warn(
        { succeeded, total: updates.length, failed: failures.length },
        `Partial failure: ${succeeded}/${updates.length} updates succeeded, ${failures.length} failed`
      );
    }

    return { attempted: updates.length, succeeded, failures };
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

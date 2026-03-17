import { randomUUID } from "node:crypto";
import type { Admin, Producer } from "kafkajs";
import { Kafka } from "kafkajs";
import type {
  ConfigField,
  DataSink,
  HealthCheckResult,
  PluginConfig,
  SinkPublishResult,
} from "../types";
import type { VehicleUpdate } from "../../types";

/** Default timeout for health check broker probe (ms). Overridable via `healthCheckTimeoutMs` config. */
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

export class RedpandaSink implements DataSink {
  readonly type = "redpanda";
  readonly name = "Redpanda/Kafka Message Broker";
  readonly configSchema: ConfigField[] = [
    {
      name: "brokers",
      label: "Brokers",
      type: "string",
      required: true,
      default: "localhost:19092",
      placeholder: "host1:9092,host2:9092",
    },
    { name: "topic", label: "Topic", type: "string", default: "dispatch.vehicle.positions" },
    { name: "batchSize", label: "Batch Size", type: "number", default: 500 },
    {
      name: "acks",
      label: "Acks",
      type: "select",
      default: 1,
      options: [
        { label: "None (0)", value: "0" },
        { label: "Leader (1)", value: "1" },
        { label: "All (-1)", value: "-1" },
      ],
    },
  ];
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private topic = "dispatch.vehicle.positions";
  private batchSize = 500;
  private acks: number = 1;
  private healthCheckTimeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

  async connect(config: PluginConfig): Promise<void> {
    const brokers = ((config.brokers as string) || "localhost:19092").split(",");
    this.topic = (config.topic as string) || "dispatch.vehicle.positions";
    this.batchSize = (config.batchSize as number) || 500;
    this.acks = config.acks != null ? Number(config.acks) : 1;
    this.healthCheckTimeoutMs =
      (config.healthCheckTimeoutMs as number) || DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

    this.kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
    });

    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    this.kafka = null;
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (!this.producer) return;

    const now = new Date().toISOString();
    const messages = updates.map((update) => ({
      key: update.id,
      value: JSON.stringify({
        eventType: "vehicle.position",
        eventId: randomUUID(),
        occurredOn: now,
        vehicleId: update.id,
        vehicleType: update.type,
        latitude: update.latitude,
        longitude: update.longitude,
        timestamp: now,
      }),
    }));

    if (messages.length <= this.batchSize) {
      await this.producer.send({ topic: this.topic, messages, acks: this.acks });
      return;
    }

    // Chunked publishing with partial failure handling
    const chunks: (typeof messages)[] = [];
    for (let i = 0; i < messages.length; i += this.batchSize) {
      chunks.push(messages.slice(i, i + this.batchSize));
    }

    const results = await Promise.allSettled(
      chunks.map((chunk) =>
        this.producer!.send({ topic: this.topic, messages: chunk, acks: this.acks })
      )
    );

    const failures = results
      .map((result, i) => ({ result, chunkIndex: i }))
      .filter(
        (entry): entry is { result: PromiseRejectedResult; chunkIndex: number } =>
          entry.result.status === "rejected"
      )
      .map(({ result, chunkIndex }) => {
        const error =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        const startIdx = chunkIndex * this.batchSize;
        const chunkSize = chunks[chunkIndex].length;
        console.error(
          `[RedpandaSink] Chunk ${chunkIndex} failed (messages ${startIdx}–${startIdx + chunkSize - 1}): ${error}`
        );
        return { itemId: `chunk-${chunkIndex}`, error };
      });

    const failedMessageCount = failures.reduce((sum, f) => {
      const chunkIndex = Number.parseInt(f.itemId.replace("chunk-", ""), 10);
      return sum + chunks[chunkIndex].length;
    }, 0);
    const succeeded = messages.length - failedMessageCount;

    if (failures.length > 0 && succeeded === 0) {
      throw new Error(
        `All ${chunks.length} chunks failed to publish. First error: ${failures[0].error}`
      );
    }

    if (failures.length > 0) {
      console.warn(
        `[RedpandaSink] Partial failure: ${chunks.length - failures.length}/${chunks.length} chunks succeeded (${succeeded}/${messages.length} messages)`
      );
    }

    return { attempted: messages.length, succeeded, failures };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.producer || !this.kafka) {
      return { healthy: false, message: "producer not initialized" };
    }

    let admin: Admin | null = null;
    const start = Date.now();

    try {
      admin = this.kafka.admin();
      await admin.connect();

      const result = await Promise.race([
        admin.describeCluster(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("health check timed out")), this.healthCheckTimeoutMs)
        ),
      ]);

      const latencyMs = Date.now() - start;
      return {
        healthy: true,
        message: `cluster reachable (${result.brokers.length} broker${result.brokers.length !== 1 ? "s" : ""})`,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message, latencyMs };
    } finally {
      if (admin) {
        await admin.disconnect().catch(() => {});
      }
    }
  }
}

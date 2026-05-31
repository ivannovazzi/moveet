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
import { fleetRoster } from "../fleetRoster";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RedpandaSink");

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
    {
      name: "format",
      label: "Payload Format",
      type: "select",
      default: "dispatch",
      options: [
        { label: "Dispatch (vehicle.position event)", value: "dispatch" },
        { label: "Trajectory-engine telemetry", value: "trajectory" },
      ],
    },
    {
      name: "keyBy",
      label: "Trajectory Key Source",
      type: "select",
      default: "vehicleId",
      options: [
        { label: "Vehicle id (synthetic / default)", value: "vehicleId" },
        { label: "Connector device id (real fleet roster)", value: "deviceId" },
      ],
    },
    {
      name: "defaultAltitude",
      label: "Default Altitude (m)",
      type: "number",
      default: 0,
      placeholder: "metres above sea level (trajectory format)",
    },
    {
      name: "defaultAccuracy",
      label: "Default Accuracy (m)",
      type: "number",
      default: 5,
      placeholder: "GPS horizontal accuracy (trajectory format)",
    },
  ];
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private topic = "dispatch.vehicle.positions";
  private batchSize = 500;
  private acks: number = 1;
  private format: "dispatch" | "trajectory" = "dispatch";
  private keyBy: "vehicleId" | "deviceId" = "vehicleId";
  private defaultAltitude = 0;
  private defaultAccuracy = 5;
  private healthCheckTimeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

  async connect(config: PluginConfig): Promise<void> {
    const brokers = ((config.brokers as string) || "localhost:19092").split(",");
    this.topic = (config.topic as string) || "dispatch.vehicle.positions";
    this.batchSize = (config.batchSize as number) || 500;

    // acks must be one of kafkajs's accepted values. Coercing silently (e.g.
    // "all" → NaN, "2" → 2) produces a producer that throws on every send,
    // turning the sink into a silent black hole — so validate up front.
    const acks = config.acks != null ? Number(config.acks) : 1;
    if (acks !== 0 && acks !== 1 && acks !== -1) {
      throw new Error(`RedpandaSink: invalid acks value "${config.acks}" (must be 0, 1, or -1)`);
    }
    this.acks = acks;

    const format = (config.format as string) || "dispatch";
    if (format !== "dispatch" && format !== "trajectory") {
      throw new Error(
        `RedpandaSink: invalid format "${format}" (must be "dispatch" or "trajectory")`
      );
    }
    this.format = format;

    const keyBy = (config.keyBy as string) || "vehicleId";
    if (keyBy !== "vehicleId" && keyBy !== "deviceId") {
      throw new Error(`RedpandaSink: invalid keyBy "${keyBy}" (must be "vehicleId" or "deviceId")`);
    }
    this.keyBy = keyBy;

    const altitude = config.defaultAltitude != null ? Number(config.defaultAltitude) : 0;
    this.defaultAltitude = Number.isFinite(altitude) ? altitude : 0;
    const accuracy = config.defaultAccuracy != null ? Number(config.defaultAccuracy) : 5;
    this.defaultAccuracy = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 5;

    this.healthCheckTimeoutMs =
      (config.healthCheckTimeoutMs as number) || DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

    this.kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
    });

    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
    try {
      await this.producer.connect();
    } catch (err) {
      // Tear down the half-connected producer so its internal connection/retry
      // machinery doesn't leak — connect() failing means the plugin is never
      // stored in activeSinks, so disconnect() would never be called otherwise.
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
      this.kafka = null;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    this.kafka = null;
  }

  /** Native moveet event shape, published to `dispatch.vehicle.positions`. */
  private buildDispatchMessages(updates: VehicleUpdate[]) {
    const now = new Date().toISOString();
    return updates.map((update) => ({
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
  }

  /**
   * Pure-GPS telemetry shape consumed by the external trajectory-engine. Every
   * field is required by the engine's frozen schema; `altitude`/`accuracy` are
   * sourced from config defaults (moveet does not simulate them) and `ignition`
   * is derived from speed.
   *
   * The payload carries the device's **`deviceId` as a string** and has NO
   * `vehicleId` — the engine resolves `deviceId → vehicleId` itself via the
   * connector's assignment events. The Kafka message key is the same
   * `deviceId`.
   *
   * Keying (`keyBy`):
   *  - `vehicleId` (default / synthetic): one message per update. The
   *    simulator's own id (e.g. `"static-0"`, `"42"`) is emitted verbatim as the
   *    `deviceId` string and used as the Kafka key.
   *  - `deviceId`: the simulator is driving the connector's *real* vehicles, so
   *    each update fans out to the device(s) currently bound to that vehicle in
   *    the shared {@link fleetRoster}. Both the Kafka key and the payload
   *    `deviceId` are the real connector `deviceId`. Updates for a vehicle with
   *    no currently-bound device produce no messages (an unbind silently stops
   *    telemetry for that device).
   */
  private buildTrajectoryMessages(updates: VehicleUpdate[]) {
    const ts = Date.now();
    const toMessage = (deviceId: string, update: VehicleUpdate) => {
      const speed = Math.max(0, (update.speed ?? 0) / 3.6); // km/h → m/s
      const heading = (((update.heading ?? 0) % 360) + 360) % 360; // → [0, 360)
      return {
        key: deviceId,
        value: JSON.stringify({
          ts,
          deviceId,
          lat: update.latitude,
          lon: update.longitude,
          speed,
          heading,
          altitude: this.defaultAltitude,
          accuracy: this.defaultAccuracy,
          ignition: speed > 0.5,
        }),
      };
    };

    if (this.keyBy === "deviceId") {
      return updates.flatMap((update) => {
        const devices = fleetRoster.devicesForVehicle(update.id);
        return devices.map((d) => toMessage(d.deviceId, update));
      });
    }

    // Default (synthetic): the simulator's vehicle id is the device id; emit it
    // verbatim as a string so the trajectory payload always carries a string
    // deviceId.
    return updates.map((update) => toMessage(update.id, update));
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (!this.producer) return;

    const messages =
      this.format === "trajectory"
        ? this.buildTrajectoryMessages(updates)
        : this.buildDispatchMessages(updates);

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
        logger.error(
          { chunkIndex, start: startIdx, end: startIdx + chunkSize - 1, error },
          `Chunk ${chunkIndex} failed (messages ${startIdx}–${startIdx + chunkSize - 1})`
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
      logger.warn(
        {
          chunksSucceeded: chunks.length - failures.length,
          chunksTotal: chunks.length,
          messagesSucceeded: succeeded,
          messagesTotal: messages.length,
        },
        `Partial failure: ${chunks.length - failures.length}/${chunks.length} chunks succeeded (${succeeded}/${messages.length} messages)`
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

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        admin.describeCluster(),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("health check timed out")),
            this.healthCheckTimeoutMs
          );
        }),
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

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

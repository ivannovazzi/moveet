import { randomUUID } from "node:crypto";
import type { Admin, Message, Producer } from "kafkajs";
import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import {
  TELEMETRY_LOCATION_AVRO_SCHEMA,
  TELEMETRY_LOCATION_AVRO_SUBJECT,
  TELEMETRY_LOCATION_EVENT_TYPE,
} from "@moveet/shared-types";
import type {
  ConfigField,
  DataSink,
  HealthCheckResult,
  PluginConfig,
  SinkPublishResult,
} from "../types";
import type { VehicleUpdate } from "../../types";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RedpandaSink");

/** Default timeout for health check broker probe (ms). Overridable via `healthCheckTimeoutMs` config. */
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * A single value in a {@link PayloadTemplate}. Resolved per-message against the
 * {@link MessageContext}:
 *  - `number` / `boolean` / `null` → emitted literally.
 *  - `string` starting with `"="` → literal string (the `=` is stripped).
 *  - any other `string` → a dot-path into the context; resolving to `undefined`
 *    omits the key entirely.
 *  - nested object → recursed.
 */
type TemplateToken = string | number | boolean | null | { [key: string]: TemplateToken };
type PayloadTemplate = Record<string, TemplateToken>;

/**
 * The per-message context every template / `keyField` resolves against. Built
 * once per {@link VehicleUpdate} in {@link RedpandaSink.buildContext}.
 */
interface MessageContext {
  id: string;
  type: VehicleUpdate["type"];
  lat: number;
  lon: number;
  heading: number;
  /** Ground speed in km/h. */
  speedKmh: number;
  /** Ground speed in m/s. */
  speed: number;
  ts: number;
  ignition: boolean;
  altitude: number;
  accuracy: number;
  metadata: Record<string, unknown>;
  /**
   * Present only when `fanOut` is configured: the current element of the
   * fanned-out array, so per-device fields are reachable via `device.*` in
   * `keyField` / `payloadTemplate`.
   */
  device?: unknown;
}

/**
 * Built-in `trajectory` preset, expressed as a template. Reproduces the
 * pure-GPS telemetry payload consumed by the trajectory-engine, plus a
 * metadata-sourced `deviceType` (omitted automatically when absent, preserving
 * back-compat with the prior payload that had no deviceType).
 */
const TRAJECTORY_TEMPLATE: PayloadTemplate = {
  ts: "ts",
  deviceId: "id",
  deviceType: "metadata.deviceType",
  lat: "lat",
  lon: "lon",
  speed: "speed",
  heading: "heading",
  altitude: "altitude",
  accuracy: "accuracy",
  ignition: "ignition",
};

/** Resolve a dot-path (e.g. `"metadata.deviceType"`) against a context object. */
function resolvePath(context: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc != null && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, context);
}

/**
 * Resolve a {@link PayloadTemplate} against a context into a plain JSON object.
 * Keys whose value is a path resolving to `undefined` are omitted.
 */
function resolveTemplate(
  template: PayloadTemplate,
  context: MessageContext
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, token] of Object.entries(template)) {
    const resolved = resolveToken(token, context);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

function resolveToken(token: TemplateToken, context: MessageContext): unknown {
  // Literals: number / boolean / null are emitted verbatim.
  if (typeof token === "number" || typeof token === "boolean" || token === null) {
    return token;
  }
  if (typeof token === "string") {
    // "=literal" → literal string (strip the leading "=").
    if (token.startsWith("=")) return token.slice(1);
    // Otherwise a dot-path into the context.
    return resolvePath(context, token);
  }
  // Nested object → recurse.
  return resolveTemplate(token as PayloadTemplate, context);
}

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
        { label: "Canonical telemetry (Confluent-AVRO)", value: "canonical-avro" },
      ],
    },
    {
      name: "schemaRegistryUrl",
      label: "Schema Registry URL",
      type: "string",
      default: "http://localhost:18081",
      placeholder: "http://localhost:18081",
      description: "Confluent Schema Registry endpoint, used by the canonical-avro format.",
    },
    {
      name: "sourceService",
      label: "Source Service",
      type: "string",
      default: "moveet-simulator",
      description: "Populates source.service in the canonical envelope.",
    },
    {
      name: "sourceEnvironment",
      label: "Source Environment",
      type: "string",
      default: "dev",
      description: "Populates source.environment in the canonical envelope.",
    },
    {
      name: "keyField",
      label: "Message Key Field",
      type: "string",
      default: "id",
      placeholder: "dot-path into the message context, e.g. id or metadata.deviceId",
    },
    {
      name: "payloadTemplate",
      label: "Payload Template (JSON)",
      type: "json",
      placeholder:
        'Overrides the format preset. Values: paths ("lat"), literals ("=const", 0, true, null), or nested objects.',
    },
    {
      name: "fanOut",
      label: "Fan-out Array Path",
      type: "string",
      placeholder: "e.g. metadata.devices",
      description:
        "Optional dot-path to an array in the message context. When set, one message is emitted per array element, each reachable via device.* in keyField/payloadTemplate. Missing/empty array = no messages. Unset = one message per update.",
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
  private format: "dispatch" | "trajectory" | "canonical-avro" = "dispatch";
  private keyField = "id";
  // Canonical-AVRO format state (populated in connect() only for that format).
  private schemaRegistryUrl = "http://localhost:18081";
  private sourceService = "moveet-simulator";
  private sourceEnvironment = "dev";
  private registry: SchemaRegistry | null = null;
  private schemaId: number | null = null;
  private payloadTemplate: PayloadTemplate | null = null;
  // Optional dot-path to an array in the context. When set, each update fans
  // out to one message per array element. null = disabled.
  private fanOut: string | null = null;
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
    if (format !== "dispatch" && format !== "trajectory" && format !== "canonical-avro") {
      throw new Error(
        `RedpandaSink: invalid format "${format}" (must be "dispatch", "trajectory", or "canonical-avro")`
      );
    }
    this.format = format;

    if (format === "canonical-avro") {
      const url = (config.schemaRegistryUrl as string) || "http://localhost:18081";
      if (typeof url !== "string" || url.trim() === "") {
        throw new Error("RedpandaSink: schemaRegistryUrl must be a non-empty string");
      }
      this.schemaRegistryUrl = url;
      this.sourceService = (config.sourceService as string) || "moveet-simulator";
      this.sourceEnvironment = (config.sourceEnvironment as string) || "dev";
    }

    const keyField = (config.keyField as string) || "id";
    if (typeof keyField !== "string" || keyField.trim() === "") {
      throw new Error(
        `RedpandaSink: invalid keyField "${keyField}" (must be a non-empty dot-path)`
      );
    }
    this.keyField = keyField;

    this.payloadTemplate = this.parsePayloadTemplate(config.payloadTemplate);

    const fanOut = config.fanOut;
    this.fanOut = typeof fanOut === "string" && fanOut.trim() !== "" ? fanOut : null;

    const altitude = config.defaultAltitude != null ? Number(config.defaultAltitude) : 0;
    this.defaultAltitude = Number.isFinite(altitude) ? altitude : 0;
    const accuracy = config.defaultAccuracy != null ? Number(config.defaultAccuracy) : 5;
    this.defaultAccuracy = Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : 5;

    const healthCheckTimeout =
      config.healthCheckTimeoutMs != null
        ? Number(config.healthCheckTimeoutMs)
        : DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
    this.healthCheckTimeoutMs =
      Number.isFinite(healthCheckTimeout) && healthCheckTimeout > 0
        ? healthCheckTimeout
        : DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

    this.kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
    });

    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
    try {
      await this.producer.connect();
      // The producer is created with auto-topic-creation disabled, so a missing
      // topic would otherwise only surface on the first publish. Fail fast here
      // with a clear error naming the topic instead.
      const admin = this.kafka.admin();
      try {
        await admin.connect();
        const topics = await admin.listTopics();
        if (!topics.includes(this.topic)) {
          throw new Error(
            `RedpandaSink: topic "${this.topic}" does not exist on the configured brokers ` +
              `(auto-topic-creation is disabled — create the topic first)`
          );
        }
      } finally {
        await admin.disconnect().catch(() => {});
      }
      // For the canonical-AVRO format, register (idempotent) the canonical
      // schema with Schema Registry and cache the returned schema id, which
      // every encode() prefixes onto the wire payload (Confluent framing).
      if (this.format === "canonical-avro") {
        this.registry = new SchemaRegistry({ host: this.schemaRegistryUrl });
        const registered = await this.registry.register(
          {
            type: SchemaType.AVRO,
            schema: JSON.stringify(TELEMETRY_LOCATION_AVRO_SCHEMA),
          },
          { subject: TELEMETRY_LOCATION_AVRO_SUBJECT }
        );
        this.schemaId = registered.id;
      }
    } catch (err) {
      // Tear down the half-connected producer so its internal connection/retry
      // machinery doesn't leak — connect() failing means the plugin is never
      // stored in activeSinks, so disconnect() would never be called otherwise.
      await this.producer.disconnect().catch(() => {});
      this.producer = null;
      this.kafka = null;
      this.registry = null;
      this.schemaId = null;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    this.kafka = null;
    this.registry = null;
    this.schemaId = null;
  }

  /**
   * Native moveet event shape, published to `dispatch.vehicle.positions`.
   *
   * Honors update-supplied telemetry fields (e.g. from the realism engine):
   * `timestamp` back-dates the fix time (so store-and-forward bursts keep their
   * original times rather than collapsing to wall-clock), and `accuracy` /
   * `connected` are emitted when present. `occurredOn` always reflects emit
   * (wall-clock) time, distinct from the fix `timestamp`.
   */
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
        timestamp: update.timestamp != null ? new Date(update.timestamp).toISOString() : now,
        ...(update.accuracy != null ? { accuracy: update.accuracy } : {}),
        ...(update.connected != null ? { connected: update.connected } : {}),
      }),
    }));
  }

  /**
   * Parse + validate the optional `payloadTemplate` config. Accepts either an
   * already-parsed object or a JSON string (the `json` config field may arrive
   * as either). Returns `null` when unset (→ fall back to the `format` preset).
   */
  private parsePayloadTemplate(raw: unknown): PayloadTemplate | null {
    if (raw == null || raw === "") return null;
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("RedpandaSink: payloadTemplate is not valid JSON");
      }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("RedpandaSink: payloadTemplate must be a JSON object");
    }
    return parsed as PayloadTemplate;
  }

  /**
   * The effective template for the current config: an explicit
   * `payloadTemplate` overrides the `format` preset. Presets are implemented
   * internally as templates — see {@link TRAJECTORY_TEMPLATE}. The `dispatch`
   * preset keeps its dedicated code path (it injects a fresh UUID / timestamp
   * per message, which a static template can't express) and so returns `null`
   * here, signalling {@link buildMessages} to use {@link buildDispatchMessages}.
   */
  private resolveActiveTemplate(): PayloadTemplate | null {
    if (this.payloadTemplate) return this.payloadTemplate;
    if (this.format === "trajectory") return TRAJECTORY_TEMPLATE;
    return null;
  }

  /**
   * Build the per-message context every template / `keyField` resolves against.
   * `speed` is m/s (the trajectory-engine's unit), `speedKmh` is the raw
   * source value. Update-supplied `timestamp`/`accuracy`/`connected` (e.g. from
   * the realism engine) take precedence; otherwise `ts` falls back to the batch
   * `Date.now()`, `accuracy` to the configured default, and `ignition` is
   * derived from m/s speed.
   */
  private buildContext(update: VehicleUpdate, ts: number): MessageContext {
    const speedKmh = update.speed ?? 0;
    const speed = speedKmh / 3.6; // km/h → m/s
    return {
      id: update.id,
      type: update.type,
      lat: update.latitude,
      lon: update.longitude,
      heading: update.heading ?? 0,
      speedKmh,
      speed,
      ts: update.timestamp ?? ts,
      // A disconnected fix means ignition off regardless of speed; otherwise
      // derive it from ground speed as before.
      ignition: update.connected === false ? false : speed > 0.5,
      altitude: this.defaultAltitude,
      accuracy: update.accuracy ?? this.defaultAccuracy,
      metadata: update.metadata ?? {},
    };
  }

  /** Resolve one context into a single Kafka message via the template. */
  private buildMessage(template: PayloadTemplate, context: MessageContext) {
    const keyValue = resolvePath(context, this.keyField);
    return {
      key: keyValue === undefined || keyValue === null ? undefined : String(keyValue),
      value: JSON.stringify(resolveTemplate(template, context)),
    };
  }

  /**
   * Build the messages for a batch of updates from a {@link PayloadTemplate}:
   * the payload is the resolved template and the Kafka key is the `keyField`
   * dot-path, both resolved against the per-message context.
   *
   * Without `fanOut`, each update maps to exactly one message. With `fanOut`
   * set, the array at that path is resolved against the context and each
   * element produces one message whose context carries `device: <element>`
   * (so the shared position/speed/etc. are co-located across a vehicle's
   * devices, while per-device fields are reachable via `device.*`). A
   * missing/empty array emits nothing for that update.
   */
  private buildTemplateMessages(updates: VehicleUpdate[], template: PayloadTemplate) {
    const ts = Date.now();
    return updates.flatMap((update) => {
      const context = this.buildContext(update, ts);

      if (!this.fanOut) {
        return [this.buildMessage(template, context)];
      }

      const array = resolvePath(context, this.fanOut);
      if (!Array.isArray(array) || array.length === 0) {
        return [];
      }

      return array.map((device) => this.buildMessage(template, { ...context, device }));
    });
  }

  /**
   * Map a per-message {@link MessageContext} onto the canonical telemetry
   * envelope. Fields the simulator can't supply (satellites, battery, network,
   * position_origin) are left null per the schema's union defaults.
   * `data.source` is GPS unless the device/update metadata marks it `mobile`.
   */
  private buildCanonicalEnvelope(context: MessageContext): Record<string, unknown> {
    const deviceType =
      (context.metadata?.deviceType as string | undefined) ??
      (context.device != null && typeof context.device === "object"
        ? ((context.device as Record<string, unknown>).deviceType as string | undefined)
        : undefined);
    const telemetrySource = deviceType === "mobile" ? "MOBILE" : "GPS";

    return {
      event_id: randomUUID(),
      event_type: TELEMETRY_LOCATION_EVENT_TYPE,
      event_version: 1,
      occurred_at: new Date().toISOString(),
      source: { service: this.sourceService, environment: this.sourceEnvironment },
      metadata: { correlation_id: null, causation_id: null, trace_id: null },
      data: {
        device_id: String(context.id),
        source: telemetrySource,
        recorded_at: new Date(context.ts).toISOString(),
        latitude: context.lat,
        longitude: context.lon,
        accuracy_meters: context.accuracy,
        speed_mps: context.speed,
        heading_degrees: context.heading,
        altitude_meters: context.altitude,
        satellites: null,
        ignition_on: context.ignition,
        moving: context.speed > 0.5,
        battery_level: null,
        battery_charging: null,
        network: null,
        position_origin: null,
        sensor_readings: {},
      },
    };
  }

  /**
   * Confluent-AVRO-encode one context into a Kafka message. The Kafka key is
   * resolved via the same `keyField` dot-path as the JSON formats; the value is
   * the registry-encoded Buffer (5-byte Confluent header + Avro body).
   */
  private async buildCanonicalAvroMessage(context: MessageContext): Promise<Message> {
    if (!this.registry || this.schemaId == null) {
      throw new Error("RedpandaSink: schema registry not initialized for canonical-avro format");
    }
    const keyValue = resolvePath(context, this.keyField);
    const value = await this.registry.encode(this.schemaId, this.buildCanonicalEnvelope(context));
    return {
      key: keyValue === undefined || keyValue === null ? undefined : String(keyValue),
      value,
    };
  }

  /**
   * Build canonical-AVRO messages for a batch, honouring `fanOut` and
   * `keyField` exactly like the JSON template path. Each emitted message's
   * value is a registry-encoded Buffer.
   */
  private async buildCanonicalAvroMessages(updates: VehicleUpdate[]): Promise<Message[]> {
    const ts = Date.now();
    const contexts: MessageContext[] = updates.flatMap((update) => {
      const context = this.buildContext(update, ts);
      if (!this.fanOut) return [context];

      const array = resolvePath(context, this.fanOut);
      if (!Array.isArray(array) || array.length === 0) return [];
      return array.map((device) => ({ ...context, device }));
    });
    return Promise.all(contexts.map((context) => this.buildCanonicalAvroMessage(context)));
  }

  /**
   * Build the Kafka messages for a batch of updates. An explicit
   * `payloadTemplate` (or the `trajectory` preset, expressed as a template)
   * drives {@link buildTemplateMessages} (which honours `fanOut`); otherwise
   * the `dispatch` preset's dedicated code path is used (one message per
   * update, no fan-out).
   */
  private async buildMessages(updates: VehicleUpdate[]): Promise<Message[]> {
    if (this.format === "canonical-avro") {
      return this.buildCanonicalAvroMessages(updates);
    }
    const template = this.resolveActiveTemplate();
    return template
      ? this.buildTemplateMessages(updates, template)
      : this.buildDispatchMessages(updates);
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (!this.producer) return;

    const messages = await this.buildMessages(updates);

    if (messages.length <= this.batchSize) {
      await this.producer.send({ topic: this.topic, messages, acks: this.acks });
      return;
    }

    // Chunked publishing: chunks are sent sequentially and the batch is
    // aborted on the first failure, so a retried/late chunk can never be
    // delivered out of order relative to the rest of the batch.
    const chunks: (typeof messages)[] = [];
    for (let i = 0; i < messages.length; i += this.batchSize) {
      chunks.push(messages.slice(i, i + this.batchSize));
    }

    const producer = this.producer;
    let succeeded = 0;
    const failures: Array<{ itemId: string; error: string }> = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      try {
        await producer.send({ topic: this.topic, messages: chunks[chunkIndex], acks: this.acks });
        succeeded += chunks[chunkIndex].length;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const startIdx = chunkIndex * this.batchSize;
        const chunkSize = chunks[chunkIndex].length;
        logger.error(
          { chunkIndex, start: startIdx, end: startIdx + chunkSize - 1, error },
          `Chunk ${chunkIndex} failed (messages ${startIdx}–${startIdx + chunkSize - 1})`
        );
        failures.push({ itemId: `chunk-${chunkIndex}`, error });
        // Abort the remainder of the batch to preserve ordering.
        for (let j = chunkIndex + 1; j < chunks.length; j++) {
          failures.push({
            itemId: `chunk-${j}`,
            error: `not attempted (batch aborted after chunk ${chunkIndex} failed)`,
          });
        }
        break;
      }
    }

    if (failures.length > 0 && succeeded === 0) {
      throw new Error(
        `First chunk failed to publish; ${chunks.length - 1} remaining chunk(s) aborted to preserve ordering. Error: ${failures[0].error}`
      );
    }

    if (failures.length > 0) {
      logger.warn(
        {
          chunksSucceeded: chunks.length - failures.length,
          chunksTotal: chunks.length,
          messagesSucceeded: succeeded,
          messagesTotal: messages.length,
          messagesNotDelivered: messages.length - succeeded,
        },
        `Partial failure: ${chunks.length - failures.length}/${chunks.length} chunks sent (${succeeded}/${messages.length} messages); remainder aborted to preserve ordering`
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
      const adminClient = this.kafka.admin();
      admin = adminClient;

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      // connect() itself can hang on an unreachable broker, so it must live
      // inside the timeout race alongside describeCluster().
      const probe = (async () => {
        await adminClient.connect();
        return adminClient.describeCluster();
      })();
      // If the timeout wins the race, the probe may still reject later with
      // nothing awaiting it; swallow that so it doesn't surface as a spurious
      // process-level unhandledRejection. The race below still observes the
      // probe's rejection when the probe loses first.
      probe.catch(() => {});
      const result = await Promise.race([
        probe,
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

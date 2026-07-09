import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Admin, Message, Producer, SASLOptions } from "kafkajs";
import { Kafka } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import type {
  ConfigField,
  DataSink,
  HealthCheckResult,
  PluginConfig,
  PublishContext,
  SinkPublishResult,
} from "../types";
import type { VehicleUpdate } from "../../types";
import { createLogger } from "../../utils/logger";
import { parsePayloadTemplate, resolveTemplate, type PayloadTemplate } from "../format/template";
import {
  expandContexts,
  resolveKey,
  type ContextDefaults,
  type MessageContext,
} from "../format/context";
import { chunk, sendChunksParallel, type ChunkPlan } from "../format/chunking";

const logger = createLogger("RedpandaSink");

/** Default timeout for health check broker probe (ms). Overridable via `healthCheckTimeoutMs` config. */
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

// ─── Canonical Telemetry AVRO Schema ────────────────────────────────
//
// The platform's canonical telemetry-ingest envelope, published Confluent-AVRO
// encoded to `telemetry.device.raw`. The schema is versioned in
// `schemas/canonical-telemetry.v1.avsc` (loaded at module init below) rather
// than hardcoded inline, so it can be round-trip tested against the real avro
// codec and reviewed/diffed as a contract artifact. Field order and types MUST
// match the platform's registered schema exactly; do not reorder or retype
// fields. This is config of the redpanda sink (the only producer of these
// events), not a shared cross-app type.

/** Bare name of the versioned schema artifact. */
const TELEMETRY_LOCATION_AVRO_SCHEMA_FILE = "canonical-telemetry.v1.avsc";

/**
 * Resolve the versioned `.avsc` artifact. It lives at
 * `src/plugins/sinks/schemas/`. Running under tsx/vitest the module dir IS that
 * `schemas/` parent, so the first candidate hits. Running the esbuild bundle
 * (`dist/index.js`) the module dir is `dist/`, so we also probe the original
 * `src` tree (which the image's `source` stage preserves alongside `dist`),
 * keeping the canonical schema a single source-of-truth artifact for both.
 */
function resolveSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "schemas", TELEMETRY_LOCATION_AVRO_SCHEMA_FILE),
    // bundle case: dist/ sibling of src/plugins/sinks/schemas
    join(here, "..", "src", "plugins", "sinks", "schemas", TELEMETRY_LOCATION_AVRO_SCHEMA_FILE),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** Filesystem path to the versioned canonical-telemetry AVRO schema artifact. */
export const TELEMETRY_LOCATION_AVRO_SCHEMA_PATH = resolveSchemaPath();

/**
 * Confluent-AVRO schema for the canonical `telemetry.location.reported` event,
 * loaded from the versioned `.avsc` artifact. Registered under subject
 * `telemetry.device.raw-telemetry.location.reported`.
 */
export const TELEMETRY_LOCATION_AVRO_SCHEMA: Record<string, unknown> = JSON.parse(
  readFileSync(TELEMETRY_LOCATION_AVRO_SCHEMA_PATH, "utf8")
);

/** Subject under which the canonical schema is registered in Schema Registry. */
export const TELEMETRY_LOCATION_AVRO_SUBJECT = "telemetry.device.raw-telemetry.location.reported";

/** Canonical `event_type` for telemetry location reports. */
export const TELEMETRY_LOCATION_EVENT_TYPE = "telemetry.location.reported";

/**
 * Built-in `trajectory` preset, expressed as a template. Reproduces the
 * pure-GPS telemetry payload consumed by the trajectory-engine, plus a
 * metadata-sourced `deviceType` (omitted automatically when absent, preserving
 * back-compat with the prior payload that had no deviceType). The template /
 * context / chunking machinery now lives in `../format/*` (sink-generic).
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

/** kafkajs `ssl` option once resolved: either `true` (system CAs) or explicit cert material. */
type ResolvedSsl =
  | true
  | { ca?: string[]; cert?: string; key?: string; rejectUnauthorized: boolean };

/** SASL mechanisms supported by the sink (kafkajs username/password mechanisms). */
const SASL_MECHANISMS = ["plain", "scram-sha-256", "scram-sha-512"] as const;

/**
 * Resolve TLS cert material from config: inline PEM (a string containing
 * `-----BEGIN`) is used verbatim, otherwise the value is treated as a filesystem
 * path and read. Lets docker wire cert paths while tests pass inline PEM.
 */
function readCertMaterial(value: unknown): string {
  const s = String(value);
  return s.includes("-----BEGIN") ? s : readFileSync(s, "utf8");
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
    {
      name: "topic",
      label: "Topic",
      type: "string",
      default: "dispatch.vehicle.positions",
    },
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
        {
          label: "Canonical telemetry (Confluent-AVRO)",
          value: "canonical-avro",
        },
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
      name: "tlsCa",
      label: "TLS CA",
      type: "string",
      placeholder: "/certs/ca (path) or inline PEM",
      description:
        "CA certificate for broker + Schema Registry TLS. Presence of any TLS field enables TLS.",
    },
    {
      name: "tlsCert",
      label: "TLS Client Cert",
      type: "string",
      placeholder: "/certs/crt (path) or inline PEM",
      description: "Client certificate for mutual TLS.",
    },
    {
      name: "tlsKey",
      label: "TLS Client Key",
      type: "string",
      placeholder: "/certs/key (path) or inline PEM",
      description: "Client private key for mutual TLS.",
    },
    {
      name: "tlsRejectUnauthorized",
      label: "TLS Reject Unauthorized",
      type: "boolean",
      default: true,
      description: "Set false to skip cert-chain verification (dev only).",
    },
    {
      name: "saslMechanism",
      label: "SASL Mechanism",
      type: "select",
      options: [
        { label: "PLAIN", value: "plain" },
        { label: "SCRAM-SHA-256", value: "scram-sha-256" },
        { label: "SCRAM-SHA-512", value: "scram-sha-512" },
      ],
      description: "Presence of SASL fields enables SASL auth.",
    },
    { name: "saslUsername", label: "SASL Username", type: "string" },
    { name: "saslPassword", label: "SASL Password", type: "password" },
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

  /**
   * Resolve the kafkajs `ssl` option from config. TLS is enabled when any of
   * `tlsCa` / `tlsCert` / `tlsKey` is set, or `tlsRejectUnauthorized` is
   * explicitly `false`. With no cert material (but TLS on), returns `true` to
   * use the system CA store. Returns `undefined` when TLS is not configured
   * (preserving the prior plaintext behaviour).
   */
  private resolveSsl(config: PluginConfig): ResolvedSsl | undefined {
    const ca = config.tlsCa != null && config.tlsCa !== "" ? config.tlsCa : undefined;
    const cert = config.tlsCert != null && config.tlsCert !== "" ? config.tlsCert : undefined;
    const key = config.tlsKey != null && config.tlsKey !== "" ? config.tlsKey : undefined;
    const explicitReject = config.tlsRejectUnauthorized === false;
    if (!ca && !cert && !key && !explicitReject) return undefined;
    return {
      ...(ca ? { ca: [readCertMaterial(ca)] } : {}),
      ...(cert ? { cert: readCertMaterial(cert) } : {}),
      ...(key ? { key: readCertMaterial(key) } : {}),
      rejectUnauthorized: !explicitReject,
    };
  }

  /**
   * Resolve the kafkajs `sasl` option from config. SASL is enabled when any of
   * `saslMechanism` / `saslUsername` / `saslPassword` is set; mechanism defaults
   * to PLAIN. Throws on an unsupported mechanism or missing credentials so a
   * misconfiguration fails fast in connect() rather than on first publish.
   */
  private resolveSasl(config: PluginConfig): SASLOptions | undefined {
    const hasAny = config.saslMechanism || config.saslUsername || config.saslPassword;
    if (!hasAny) return undefined;
    const mechanism = String(config.saslMechanism || "plain").toLowerCase();
    if (!SASL_MECHANISMS.includes(mechanism as (typeof SASL_MECHANISMS)[number])) {
      throw new Error(
        `RedpandaSink: invalid saslMechanism "${config.saslMechanism}" (must be one of ${SASL_MECHANISMS.join(", ")})`
      );
    }
    const username = config.saslUsername != null ? String(config.saslUsername) : "";
    const password = config.saslPassword != null ? String(config.saslPassword) : "";
    if (username === "" || password === "") {
      throw new Error(
        "RedpandaSink: saslUsername and saslPassword are required when SASL is enabled"
      );
    }
    return { mechanism, username, password } as SASLOptions;
  }

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

    this.payloadTemplate = parsePayloadTemplate(
      config.payloadTemplate,
      "RedpandaSink: payloadTemplate"
    );

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

    const ssl = this.resolveSsl(config);
    const sasl = this.resolveSasl(config);

    this.kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
      ...(ssl ? { ssl } : {}),
      ...(sasl ? { sasl } : {}),
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
        // When TLS is configured with explicit cert material, the Schema
        // Registry (HTTPS, possibly mutual-TLS) needs a matching https.Agent —
        // the registry client has no ssl option of its own, only `agent`.
        const agent =
          ssl && ssl !== true
            ? new Agent({
                ...(ssl.ca ? { ca: ssl.ca } : {}),
                ...(ssl.cert ? { cert: ssl.cert } : {}),
                ...(ssl.key ? { key: ssl.key } : {}),
                rejectUnauthorized: ssl.rejectUnauthorized,
              })
            : undefined;
        this.registry = new SchemaRegistry({
          host: this.schemaRegistryUrl,
          ...(agent ? { agent } : {}),
        });
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
   * The effective template for the current config: an explicit
   * `payloadTemplate` overrides the `format` preset. Presets are implemented
   * internally as templates — see {@link TRAJECTORY_TEMPLATE}. The `dispatch`
   * preset keeps its dedicated code path (it injects a fresh UUID / timestamp
   * per message, which a static template can't express) and so returns `null`
   * here, signalling {@link buildJsonMessages} to use {@link buildDispatchMessages}.
   */
  private resolveActiveTemplate(): PayloadTemplate | null {
    if (this.payloadTemplate) return this.payloadTemplate;
    if (this.format === "trajectory") return TRAJECTORY_TEMPLATE;
    return null;
  }

  /** The altitude/accuracy fallbacks the shared context builder applies. */
  private contextDefaults(): ContextDefaults {
    return { altitude: this.defaultAltitude, accuracy: this.defaultAccuracy };
  }

  /** Resolve one context into a single Kafka message via the template. */
  private buildMessage(template: PayloadTemplate, context: MessageContext) {
    return {
      key: resolveKey(context, this.keyField),
      value: JSON.stringify(resolveTemplate(template, context)),
    };
  }

  /**
   * Build the messages for a batch of updates from a {@link PayloadTemplate}:
   * the payload is the resolved template and the Kafka key is the `keyField`
   * dot-path, both resolved against the per-message context. Fan-out expansion
   * is delegated to the shared {@link expandContexts} helper.
   */
  private buildTemplateMessages(updates: VehicleUpdate[], template: PayloadTemplate) {
    return expandContexts(updates, this.fanOut, this.contextDefaults()).map((context) =>
      this.buildMessage(template, context)
    );
  }

  /**
   * Map a per-message {@link MessageContext} onto the canonical telemetry
   * envelope. Fields the simulator can't supply (satellites, battery, network,
   * position_origin) are left null per the schema's union defaults.
   * `data.source` is GPS unless the device/update metadata marks it `mobile`.
   *
   * The publish `context`'s correlation id (the inbound `x-request-id`) is
   * stamped onto `metadata.correlation_id`, and `metadata.trace_id` is taken
   * from the explicit trace id when present or derived from the correlation id
   * otherwise. Both default to `null` when no request context was threaded
   * through (e.g. the realism async path), preserving prior behaviour.
   */
  private buildCanonicalEnvelope(
    context: MessageContext,
    publishContext?: PublishContext
  ): Record<string, unknown> {
    const device =
      context.device != null && typeof context.device === "object"
        ? (context.device as Record<string, unknown>)
        : undefined;
    // Under `fanOut`, `context.id` is the GROUP id (e.g. the vehicleId), while
    // each fanned-out element carries the real per-device id. Prefer that so the
    // canonical `device_id` matches a device the consumer knows; fall back to
    // `context.id` when there's no fan-out (one entity per item).
    const deviceId =
      device?.id != null && String(device.id) !== "" ? String(device.id) : String(context.id);
    const deviceType =
      (context.metadata?.deviceType as string | undefined) ??
      (device?.deviceType as string | undefined);
    const telemetrySource = deviceType === "mobile" ? "MOBILE" : "GPS";

    const correlationId = publishContext?.correlationId ?? null;
    const traceId = publishContext?.traceId ?? correlationId;

    return {
      event_id: randomUUID(),
      event_type: TELEMETRY_LOCATION_EVENT_TYPE,
      event_version: 1,
      occurred_at: new Date().toISOString(),
      source: {
        service: this.sourceService,
        environment: this.sourceEnvironment,
      },
      metadata: {
        correlation_id: correlationId,
        causation_id: null,
        trace_id: traceId,
      },
      data: {
        device_id: deviceId,
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
  private async buildCanonicalAvroMessage(
    context: MessageContext,
    publishContext?: PublishContext
  ): Promise<Message> {
    if (!this.registry || this.schemaId == null) {
      throw new Error("RedpandaSink: schema registry not initialized for canonical-avro format");
    }
    const value = await this.registry.encode(
      this.schemaId,
      this.buildCanonicalEnvelope(context, publishContext)
    );
    return { key: resolveKey(context, this.keyField), value };
  }

  /**
   * Build the eager (JSON-serialised) Kafka messages for a batch of updates. An
   * explicit `payloadTemplate` (or the `trajectory` preset, expressed as a
   * template) drives {@link buildTemplateMessages} (which honours `fanOut`);
   * otherwise the `dispatch` preset's dedicated code path is used. NOT used for
   * the canonical-AVRO format, which encodes lazily per chunk.
   */
  private buildJsonMessages(updates: VehicleUpdate[]): Message[] {
    const template = this.resolveActiveTemplate();
    return template
      ? this.buildTemplateMessages(updates, template)
      : this.buildDispatchMessages(updates);
  }

  /**
   * Plan a publish as a list of lazily-materialised chunks (via the shared
   * {@link chunk} helper). Each chunk producer yields its Message[] only when
   * invoked, so the canonical-AVRO format encodes one chunk at a time
   * (flattening peak memory) while the JSON formats — whose serialisation is
   * cheap and already done — simply slice a pre-built array. `total` is the
   * total message count across all chunks.
   */
  private planChunks(
    updates: VehicleUpdate[],
    publishContext?: PublishContext
  ): ChunkPlan<Message> {
    if (this.format === "canonical-avro") {
      const contexts = expandContexts(updates, this.fanOut, this.contextDefaults());
      const contextChunks = chunk(contexts, this.batchSize);
      return {
        total: contexts.length,
        chunks: contextChunks.map(
          (c) => () =>
            Promise.all(c.map((ctx) => this.buildCanonicalAvroMessage(ctx, publishContext)))
        ),
      };
    }

    const messages = this.buildJsonMessages(updates);
    const messageChunks = chunk(messages, this.batchSize);
    return {
      total: messages.length,
      chunks: messageChunks.map((c) => () => Promise.resolve(c)),
    };
  }

  async publishUpdates(
    updates: VehicleUpdate[],
    context?: PublishContext
  ): Promise<SinkPublishResult | void> {
    if (!this.producer) return;
    const producer = this.producer;

    const plan = this.planChunks(updates, context);
    const { total, chunks } = plan;

    // Single send: no chunking needed (also covers the empty-batch case).
    if (chunks.length <= 1) {
      const messages = chunks.length === 1 ? await chunks[0]() : [];
      await producer.send({ topic: this.topic, messages, acks: this.acks });
      return;
    }

    // Chunked publishing: chunks are sent CONCURRENTLY (Promise.allSettled).
    // This is safe because the message stream is keyed per-entity
    // (per-vehicle/per-device) and chunking splits across keys, so two chunks
    // never carry the same key — Kafka preserves order within a key and there
    // is no cross-key ordering to preserve. Parallelising lifts throughput from
    // O(sum of chunk latencies) to O(max chunk latency), and a transient
    // failure in one chunk no longer discards every other chunk's data (the old
    // abort-on-first-failure behaviour). For the canonical-AVRO format each
    // chunk is registry-encoded inside its own task, just before its send.
    // The sink reports accurate attempted/succeeded/failures; the Publisher
    // layer mirrors those onto the delivery metrics (single source of truth),
    // so no metric recording happens here.
    const result = await sendChunksParallel(plan, async (messages) => {
      await producer.send({ topic: this.topic, messages, acks: this.acks });
    });

    const { succeeded, failures } = result;

    // Every chunk failed AND nothing was delivered: surface as a throw so the
    // publisher marks the whole sink as failed (a partial success returns the
    // metadata instead). Preserves the prior "first chunk failed" contract for
    // the all-or-nothing case.
    if (failures.length > 0 && succeeded === 0) {
      throw new Error(
        `All ${chunks.length} chunk(s) failed to publish; no messages delivered. Error: ${failures[0].error}`
      );
    }

    if (failures.length > 0) {
      const dropped = total - succeeded;
      logger.warn(
        {
          chunksSucceeded: chunks.length - failures.length,
          chunksTotal: chunks.length,
          messagesSucceeded: succeeded,
          messagesTotal: total,
          messagesNotDelivered: dropped,
        },
        `Partial failure: ${chunks.length - failures.length}/${chunks.length} chunks sent (${succeeded}/${total} messages); failed chunks dropped (at-most-once, no DLQ)`
      );
    }

    return { attempted: total, succeeded, failures };
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

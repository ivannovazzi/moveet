import type { Consumer } from "kafkajs";
import { Kafka, logLevel } from "kafkajs";
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";
import { z } from "zod";
import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle } from "../../types";
import { fleetRoster } from "../fleetRoster";
import { createLogger } from "../../utils/logger";

const logger = createLogger("ConnectorSource");

/** Default time (ms) to drain the compacted topics before resolving connect(). */
const DEFAULT_ROSTER_LOAD_TIMEOUT_MS = 10_000;

/**
 * Decoded envelopes published by the connector (dispatch-cc-consumer) on the
 * `trajectory.fleet.*` topics. Only the fields moveet needs are validated; the
 * full BASE envelope carries event_id/event_type/etc. which we ignore here.
 *
 * These mirror the connector's own Zod contract
 * (`FleetVehicleEventDataSchema` / `FleetAssignmentEventDataSchema`). The
 * Confluent Schema Registry resolves the writer schema by the id embedded in
 * each message, so moveet decodes without holding the AVRO definitions — it
 * only re-validates the decoded shape.
 */
const FleetVehicleEnvelopeSchema = z.object({
  data: z.object({
    vehicle_id: z.string(),
    plate: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    callsign: z.string().nullable().optional(),
  }),
});

const FleetAssignmentEnvelopeSchema = z.object({
  data: z.object({
    device_id: z.string(),
    vehicle_id: z.string().nullable(),
    source: z.enum(["fitted_gps", "shift"]),
    effective_from: z.string(),
  }),
});

/** Per-vehicle metadata captured from `trajectory.fleet.vehicle`. */
interface VehicleMeta {
  id: string;
  name: string;
  kind: string | null;
}

/**
 * Loads the real fleet roster from the connector by consuming its two compacted
 * AVRO topics:
 *
 *  - `trajectory.fleet.vehicle`    (key = vehicleId) — the vehicle catalogue.
 *  - `trajectory.fleet.assignment` (key = deviceId)  — device→vehicle bindings.
 *
 * The plugin drains both topics from the beginning to the current end of log
 * (compacted topics retain the latest record per key, so a single pass yields
 * the current roster), populates the shared {@link fleetRoster}, and exposes one
 * vehicle per *bound* vehicle. The `redpanda` sink in `trajectory` format then
 * keys telemetry by the real `deviceId` looked up from the roster.
 *
 * Use this with `SOURCE_TYPE=connector`. The default `static` source is
 * unchanged.
 */
export class ConnectorSource implements DataSource {
  readonly type = "connector";
  readonly name = "Connector Fleet Roster (trajectory.fleet.*)";
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
      name: "schemaRegistry",
      label: "Schema Registry URL",
      type: "string",
      required: true,
      default: "http://localhost:18081",
      placeholder: "http://localhost:8081",
    },
    {
      name: "vehicleTopic",
      label: "Vehicle Topic",
      type: "string",
      default: "trajectory.fleet.vehicle",
    },
    {
      name: "assignmentTopic",
      label: "Assignment Topic",
      type: "string",
      default: "trajectory.fleet.assignment",
    },
    {
      name: "groupId",
      label: "Consumer Group Id",
      type: "string",
      default: "moveet-adapter.fleet-roster",
    },
    {
      name: "loadTimeoutMs",
      label: "Roster Load Timeout (ms)",
      type: "number",
      default: DEFAULT_ROSTER_LOAD_TIMEOUT_MS,
    },
  ];

  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;
  private registry: SchemaRegistry | null = null;
  private vehicleMeta = new Map<string, VehicleMeta>();
  private connected = false;

  async connect(config: PluginConfig): Promise<void> {
    const brokersRaw = (config.brokers as string) || "";
    const brokers = brokersRaw
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean);
    if (brokers.length === 0) {
      throw new Error("ConnectorSource requires at least one broker");
    }

    const schemaRegistryHost = (config.schemaRegistry as string) || "";
    if (!schemaRegistryHost) {
      throw new Error("ConnectorSource requires schemaRegistry URL");
    }

    const vehicleTopic = (config.vehicleTopic as string) || "trajectory.fleet.vehicle";
    const assignmentTopic = (config.assignmentTopic as string) || "trajectory.fleet.assignment";
    const groupId = (config.groupId as string) || "moveet-adapter.fleet-roster";
    const loadTimeoutMs =
      config.loadTimeoutMs != null ? Number(config.loadTimeoutMs) : DEFAULT_ROSTER_LOAD_TIMEOUT_MS;

    // Match the connector's registry options: `wrapUnions: "never"` so decoded
    // union fields (e.g. nullable vehicle_id) are plain values, not tagged.
    this.registry = new SchemaRegistry(
      { host: schemaRegistryHost },
      { [SchemaType.AVRO]: { wrapUnions: "never" } }
    );

    this.kafka = new Kafka({
      clientId: "moveet-adapter-connector",
      brokers,
      logLevel: logLevel.NOTHING,
    });

    // A fresh roster on every (re)connect; compacted topics give us the full
    // current state on replay.
    fleetRoster.clear();
    this.vehicleMeta.clear();

    this.consumer = this.kafka.consumer({ groupId });

    try {
      await this.consumer.connect();
      await this.consumer.subscribe({
        topics: [vehicleTopic, assignmentTopic],
        fromBeginning: true,
      });
      await this.drain(vehicleTopic, assignmentTopic, loadTimeoutMs);
      this.connected = true;
      const snapshot = fleetRoster.snapshot();
      logger.info(
        {
          vehicles: this.vehicleMeta.size,
          boundVehicles: fleetRoster.boundVehicleIds().length,
          totalKnown: snapshot.vehicleIds.length,
        },
        "Fleet roster loaded from connector"
      );
    } catch (err) {
      await this.consumer.disconnect().catch(() => {});
      this.consumer = null;
      this.kafka = null;
      this.registry = null;
      this.connected = false;
      throw err;
    }
  }

  /**
   * Run the consumer until the topics fall idle (no new messages for a short
   * quiet window) or the overall load timeout elapses, then stop. Compacted
   * topics are bounded, so this converges quickly on the current roster.
   */
  private async drain(
    vehicleTopic: string,
    assignmentTopic: string,
    loadTimeoutMs: number
  ): Promise<void> {
    const consumer = this.consumer!;
    const registry = this.registry!;

    // Quiet window: once no message has arrived for this long, assume the
    // compacted log has been fully replayed. Kept well under the hard timeout.
    const idleWindowMs = Math.min(1500, Math.max(250, Math.floor(loadTimeoutMs / 4)));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        resolve();
      };

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(hardTimer);
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const hardTimer = setTimeout(finish, loadTimeoutMs);

      const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, idleWindowMs);
      };
      // Start the idle clock immediately so an empty topic resolves promptly.
      bumpIdle();

      consumer
        .run({
          eachMessage: async ({ topic, message }) => {
            bumpIdle();
            if (!message.value) return;
            try {
              const decoded = await registry.decode(message.value);
              if (topic === vehicleTopic) {
                this.handleVehicle(decoded);
              } else if (topic === assignmentTopic) {
                this.handleAssignment(decoded);
              }
            } catch (err) {
              logger.warn(
                { topic, err: err instanceof Error ? err.message : String(err) },
                "Skipping undecodable fleet message"
              );
            }
          },
        })
        .catch(fail);
    });

    await consumer.stop();
  }

  private handleVehicle(decoded: unknown): void {
    const parsed = FleetVehicleEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "Invalid fleet.vehicle event");
      return;
    }
    const { vehicle_id, kind, callsign, plate } = parsed.data.data;
    this.vehicleMeta.set(vehicle_id, {
      id: vehicle_id,
      name: callsign ?? plate ?? vehicle_id,
      kind: kind ?? null,
    });
    fleetRoster.upsertVehicle(vehicle_id);
  }

  private handleAssignment(decoded: unknown): void {
    const parsed = FleetAssignmentEnvelopeSchema.safeParse(decoded);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "Invalid fleet.assignment event");
      return;
    }
    const { device_id, vehicle_id, source } = parsed.data.data;
    fleetRoster.applyAssignment(device_id, vehicle_id, source);
  }

  async disconnect(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect().catch(() => {});
      this.consumer = null;
    }
    this.kafka = null;
    this.registry = null;
    this.vehicleMeta.clear();
    this.connected = false;
    fleetRoster.clear();
  }

  /**
   * One vehicle per *bound* vehicle (i.e. at least one device currently
   * assigned). Unbound vehicles are omitted so the simulator never drives — and
   * the sink never keys — telemetry for a vehicle with no real device.
   */
  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.connected) {
      throw new Error("ConnectorSource: not connected");
    }
    return fleetRoster.boundVehicleIds().map((id) => {
      const meta = this.vehicleMeta.get(id);
      return { id, name: meta?.name ?? id };
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.connected) {
      return { healthy: false, message: "not connected" };
    }
    const bound = fleetRoster.boundVehicleIds().length;
    return {
      healthy: true,
      message: `${bound} bound vehicle${bound === 1 ? "" : "s"} in roster`,
    };
  }
}

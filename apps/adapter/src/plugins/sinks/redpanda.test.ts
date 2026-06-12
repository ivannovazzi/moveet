import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedpandaSink, TELEMETRY_LOCATION_AVRO_SUBJECT } from "./redpanda";

// Mock kafkajs so we can intercept producer.send() and admin calls
const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

const mockAdminConnect = vi.fn().mockResolvedValue(undefined);
const mockAdminDisconnect = vi.fn().mockResolvedValue(undefined);
const mockListTopics = vi.fn().mockResolvedValue(["dispatch.vehicle.positions"]);
const mockDescribeCluster = vi.fn().mockResolvedValue({
  brokers: [{ nodeId: 0, host: "localhost", port: 9092 }],
  controller: 0,
  clusterId: "test-cluster",
});

let lastKafkaConfig: Record<string, unknown> | undefined;

vi.mock("kafkajs", () => {
  class MockKafka {
    constructor(config: Record<string, unknown>) {
      lastKafkaConfig = config;
    }
    producer() {
      return {
        connect: mockConnect,
        disconnect: mockDisconnect,
        send: mockSend,
      };
    }
    admin() {
      return {
        connect: mockAdminConnect,
        disconnect: mockAdminDisconnect,
        listTopics: mockListTopics,
        describeCluster: mockDescribeCluster,
      };
    }
  }
  return { Kafka: MockKafka };
});

// Mock the Confluent Schema Registry. register() yields a fixed schema id and
// encode() captures the envelope, returning a sentinel Buffer so the sink's
// Buffer-valued message path can be asserted without a live registry.
const mockRegister = vi.fn().mockResolvedValue({ id: 7 });
const mockEncode = vi.fn(async (_id: number, payload: unknown) =>
  Buffer.from(JSON.stringify(payload))
);
let lastRegistryHost: string | undefined;
let lastRegistryArgs: { host: string; agent?: unknown } | undefined;

vi.mock("@kafkajs/confluent-schema-registry", () => {
  class MockSchemaRegistry {
    constructor(args: { host: string; agent?: unknown }) {
      lastRegistryHost = args.host;
      lastRegistryArgs = args;
    }
    register = mockRegister;
    encode = mockEncode;
  }
  return {
    SchemaRegistry: MockSchemaRegistry,
    SchemaType: { AVRO: "AVRO", JSON: "JSON", PROTOBUF: "PROTOBUF", UNKNOWN: "UNKNOWN" },
  };
});

describe("RedpandaSink", () => {
  let sink: RedpandaSink;

  beforeEach(() => {
    vi.clearAllMocks();
    sink = new RedpandaSink();
  });

  it("has type 'redpanda'", () => {
    expect(sink.type).toBe("redpanda");
  });

  describe("event ID generation", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it("generates valid UUID v4 event IDs", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentMessages = mockSend.mock.calls[0][0].messages;
      const payload = JSON.parse(sentMessages[0].value);

      expect(payload.eventId).toMatch(UUID_REGEX);
    });

    it("generates unique event IDs for each update in a batch", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
        { id: "v2", latitude: -1.29, longitude: 36.81 },
        { id: "v3", latitude: -1.3, longitude: 36.82 },
      ]);

      const sentMessages = mockSend.mock.calls[0][0].messages;
      const eventIds = sentMessages.map((m: { value: string }) => JSON.parse(m.value).eventId);

      // All should be valid UUIDs
      for (const id of eventIds) {
        expect(id).toMatch(UUID_REGEX);
      }

      // All should be unique
      const uniqueIds = new Set(eventIds);
      expect(uniqueIds.size).toBe(eventIds.length);
    });
  });

  describe("acks configuration", () => {
    it("defaults acks to 1 when not configured", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ acks: 1 }));
    });

    it("respects acks: -1 for full ISR acknowledgement", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: -1 });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ acks: -1 }));
    });

    it("respects acks: 0 for fire-and-forget", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: 0 });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ acks: 0 }));
    });

    it("handles string acks values from select config field", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: "-1" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ acks: -1 }));
    });

    it("applies configured acks to chunked batches", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        acks: -1,
        batchSize: 1,
      });
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
        { id: "v2", latitude: -1.29, longitude: 36.81 },
      ]);

      // Should have been called twice (one per chunk)
      expect(mockSend).toHaveBeenCalledTimes(2);
      for (const call of mockSend.mock.calls) {
        expect(call[0].acks).toBe(-1);
      }
    });
  });

  describe("trajectory format", () => {
    it("emits the trajectory-engine pure-GPS schema", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        { id: "42", latitude: -1.2863, longitude: 36.8172, speed: 36, heading: 90, type: "car" },
      ]);

      const message = mockSend.mock.calls[0][0].messages[0];
      const payload = JSON.parse(message.value);

      // Exactly the 9 required fields, nothing else.
      expect(Object.keys(payload).sort()).toEqual(
        [
          "accuracy",
          "altitude",
          "deviceId",
          "heading",
          "ignition",
          "lat",
          "lon",
          "speed",
          "ts",
        ].sort()
      );
      expect(payload).toMatchObject({
        deviceId: "42",
        lat: -1.2863,
        lon: 36.8172,
        speed: 10, // 36 km/h ÷ 3.6
        heading: 90,
        altitude: 0,
        accuracy: 5,
        ignition: true,
      });
      expect(typeof payload.deviceId).toBe("string");
      expect(typeof payload.ts).toBe("number");
      // Kafka key is the device id string (= the simulator id in synthetic mode).
      expect(message.key).toBe("42");
    });

    it("converts km/h to m/s and derives ignition from speed", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        { id: "1", latitude: 0, longitude: 0, speed: 0, heading: 0 }, // stationary
      ]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.speed).toBe(0);
      expect(payload.ignition).toBe(false);
    });

    it("synthesizes missing speed/ignition fields", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([{ id: "1", latitude: 0, longitude: 0, heading: 45 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.heading).toBe(45);
      expect(payload.speed).toBe(0); // speed omitted → 0
      expect(payload.ignition).toBe(false);
    });

    it("honours configurable altitude and accuracy defaults", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "trajectory",
        defaultAltitude: 1650,
        defaultAccuracy: 8,
      });
      await sink.publishUpdates([{ id: "1", latitude: 0, longitude: 0, speed: 36, heading: 0 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.altitude).toBe(1650);
      expect(payload.accuracy).toBe(8);
    });

    it("rejects an invalid format value", async () => {
      await expect(sink.connect({ brokers: "localhost:9092", format: "bogus" })).rejects.toThrow(
        /invalid format/
      );
    });

    it("rejects an empty keyField value", async () => {
      await expect(
        sink.connect({ brokers: "localhost:9092", format: "trajectory", keyField: "   " })
      ).rejects.toThrow(/invalid keyField/);
    });

    it("still emits the native dispatch shape by default", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8, type: "car" }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.eventType).toBe("vehicle.position");
      expect(payload.vehicleId).toBe("v1");
    });

    it("dispatch format honors update-supplied timestamp/accuracy/connected", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      const fixTs = 1_700_000_000_000;
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: -1.28,
          longitude: 36.8,
          type: "car",
          timestamp: fixTs,
          accuracy: 27.5,
          connected: false,
        },
      ]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      // fix timestamp is back-dated (store-and-forward), occurredOn is wall-clock
      expect(payload.timestamp).toBe(new Date(fixTs).toISOString());
      expect(payload.occurredOn).not.toBe(payload.timestamp);
      expect(payload.accuracy).toBe(27.5);
      expect(payload.connected).toBe(false);
    });

    it("dispatch format omits accuracy/connected when absent (back-compat)", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8, type: "car" }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).not.toHaveProperty("accuracy");
      expect(payload).not.toHaveProperty("connected");
      // timestamp falls back to wall-clock (equals occurredOn in this path)
      expect(payload.timestamp).toBe(payload.occurredOn);
    });

    it("emits the simulator id verbatim as a string deviceId by default (keyBy omitted)", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([{ id: "static-7", latitude: 0, longitude: 0, speed: 10 }]);

      const message = mockSend.mock.calls[0][0].messages[0];
      const payload = JSON.parse(message.value);
      expect(message.key).toBe("static-7");
      expect(payload.deviceId).toBe("static-7");
      expect(payload).not.toHaveProperty("vehicleId");
    });
  });

  describe("trajectory preset (metadata-aware)", () => {
    it("includes deviceType from metadata and keys by id", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        {
          id: "dev-7",
          latitude: -1.3,
          longitude: 36.8,
          speed: 36,
          heading: 90,
          metadata: { deviceType: "gps" },
        },
      ]);

      const message = mockSend.mock.calls[0][0].messages[0];
      const payload = JSON.parse(message.value);
      expect(Object.keys(payload).sort()).toEqual(
        [
          "accuracy",
          "altitude",
          "deviceId",
          "deviceType",
          "heading",
          "ignition",
          "lat",
          "lon",
          "speed",
          "ts",
        ].sort()
      );
      expect(payload).toMatchObject({
        deviceId: "dev-7",
        deviceType: "gps",
        lat: -1.3,
        lon: 36.8,
        speed: 10, // 36 km/h ÷ 3.6
        heading: 90,
        altitude: 0,
        accuracy: 5,
        ignition: true,
      });
      expect(message.key).toBe("dev-7");
    });

    it("omits deviceType when metadata has none (back-compat)", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([{ id: "42", latitude: -1.28, longitude: 36.8, speed: 36 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).not.toHaveProperty("deviceType");
      expect(Object.keys(payload)).toHaveLength(9);
    });

    it("emits exactly one message per update (no fan-out)", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        { id: "a", latitude: 0, longitude: 0, speed: 10 },
        { id: "b", latitude: 1, longitude: 1, speed: 20 },
      ]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(2);
      expect(messages.map((m: { key: string }) => m.key)).toEqual(["a", "b"]);
    });
  });

  describe("keyField", () => {
    it("defaults to 'id'", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        { id: "veh-1", latitude: 0, longitude: 0, metadata: { deviceId: "d-99" } },
      ]);

      expect(mockSend.mock.calls[0][0].messages[0].key).toBe("veh-1");
    });

    it("supports a custom dot-path into metadata", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "trajectory",
        keyField: "metadata.deviceId",
      });
      await sink.publishUpdates([
        { id: "veh-1", latitude: 0, longitude: 0, metadata: { deviceId: "d-99" } },
      ]);

      expect(mockSend.mock.calls[0][0].messages[0].key).toBe("d-99");
    });
  });

  describe("payloadTemplate", () => {
    it("resolves paths, literals, undefined-omission and nested objects", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        payloadTemplate: {
          lat: "lat",
          speed: "speed", // m/s
          deviceType: "metadata.deviceType",
          missing: "metadata.nope", // undefined → omitted
          zero: 0, // number literal
          const: "=const", // string literal
          on: true, // boolean literal
          nothing: null, // null literal
          nested: { id: "id", flag: "=yes" },
        },
      });
      await sink.publishUpdates([
        {
          id: "x1",
          latitude: -1.5,
          longitude: 36.0,
          speed: 36,
          metadata: { deviceType: "gps" },
        },
      ]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).toEqual({
        lat: -1.5,
        speed: 10, // 36 km/h → m/s
        deviceType: "gps",
        zero: 0,
        const: "const",
        on: true,
        nothing: null,
        nested: { id: "x1", flag: "yes" },
      });
      expect(payload).not.toHaveProperty("missing");
    });

    it("overrides the format preset when set", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "trajectory",
        payloadTemplate: { only: "id" },
      });
      await sink.publishUpdates([{ id: "x1", latitude: 0, longitude: 0, speed: 10 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).toEqual({ only: "x1" });
    });

    it("accepts a JSON string template", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        payloadTemplate: JSON.stringify({ d: "id" }),
      });
      await sink.publishUpdates([{ id: "x1", latitude: 0, longitude: 0 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload).toEqual({ d: "x1" });
    });

    it("rejects an invalid JSON template", async () => {
      await expect(
        sink.connect({ brokers: "localhost:9092", payloadTemplate: "{not json" })
      ).rejects.toThrow(/not valid JSON/);
    });

    it("computes the context: km/h→m/s speed, ignition, ts", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        payloadTemplate: {
          speed: "speed",
          speedKmh: "speedKmh",
          ignition: "ignition",
          ts: "ts",
        },
      });
      await sink.publishUpdates([{ id: "x1", latitude: 0, longitude: 0, speed: 36 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.speed).toBe(10);
      expect(payload.speedKmh).toBe(36);
      expect(payload.ignition).toBe(true);
      expect(typeof payload.ts).toBe("number");
    });

    it("derives ignition=false when stationary", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        payloadTemplate: { ignition: "ignition" },
      });
      await sink.publishUpdates([{ id: "x1", latitude: 0, longitude: 0, speed: 0 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.ignition).toBe(false);
    });
  });

  describe("fanOut", () => {
    const template = {
      ts: "ts",
      deviceId: "device.id",
      deviceType: "device.deviceType",
      lat: "lat",
      lon: "lon",
    };

    it("emits one co-located message per array element", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        keyField: "device.id",
        fanOut: "metadata.devices",
        payloadTemplate: template,
      });
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: -1.28,
          longitude: 36.8,
          metadata: {
            devices: [
              { id: "d1", deviceType: "gps" },
              { id: "d2", deviceType: "mobile" },
            ],
          },
        },
      ]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(2);

      expect(messages.map((m: { key: string }) => m.key)).toEqual(["d1", "d2"]);

      const p1 = JSON.parse(messages[0].value);
      const p2 = JSON.parse(messages[1].value);
      // Same position across both devices → co-located.
      expect(p1.lat).toBe(-1.28);
      expect(p1.lon).toBe(36.8);
      expect(p2.lat).toBe(-1.28);
      expect(p2.lon).toBe(36.8);
      // Per-device fields differ.
      expect(p1.deviceId).toBe("d1");
      expect(p1.deviceType).toBe("gps");
      expect(p2.deviceId).toBe("d2");
      expect(p2.deviceType).toBe("mobile");
    });

    it("emits nothing for an update with an empty array", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        keyField: "device.id",
        fanOut: "metadata.devices",
        payloadTemplate: template,
      });
      await sink.publishUpdates([
        { id: "v1", latitude: 0, longitude: 0, metadata: { devices: [] } },
      ]);

      expect(mockSend.mock.calls[0][0].messages).toHaveLength(0);
    });

    it("emits nothing for an update with a missing array", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        keyField: "device.id",
        fanOut: "metadata.devices",
        payloadTemplate: template,
      });
      await sink.publishUpdates([{ id: "v1", latitude: 0, longitude: 0 }]);

      expect(mockSend.mock.calls[0][0].messages).toHaveLength(0);
    });

    it("is unchanged (one message per update) when fanOut is unset", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "trajectory",
      });
      await sink.publishUpdates([
        { id: "a", latitude: 0, longitude: 0, speed: 10 },
        { id: "b", latitude: 1, longitude: 1, speed: 20 },
      ]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(2);
      expect(messages.map((m: { key: string }) => m.key)).toEqual(["a", "b"]);
    });
  });

  describe("update-supplied telemetry fields", () => {
    it("uses update.accuracy and update.timestamp when present", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: -1.29,
          longitude: 36.82,
          speed: 36,
          heading: 90,
          accuracy: 27.5,
          timestamp: 1234567,
          connected: false,
        },
      ]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.accuracy).toBe(27.5);
      expect(payload.ts).toBe(1234567);
      // connected:false forces ignition off even though speed > 0.5.
      expect(payload.ignition).toBe(false);
    });

    it("falls back to defaults when accuracy/timestamp absent", async () => {
      const before = Date.now();
      await sink.connect({
        brokers: "localhost:9092",
        format: "trajectory",
        defaultAccuracy: 8,
      });
      await sink.publishUpdates([{ id: "v1", latitude: -1.29, longitude: 36.82, speed: 36 }]);
      const after = Date.now();

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      // Absent accuracy → configured default.
      expect(payload.accuracy).toBe(8);
      // Absent timestamp → batch Date.now() (existing behavior).
      expect(payload.ts).toBeGreaterThanOrEqual(before);
      expect(payload.ts).toBeLessThanOrEqual(after);
      // Absent connected → ignition derived from speed (36 km/h → 10 m/s > 0.5).
      expect(payload.ignition).toBe(true);
    });
  });

  describe("canonical-avro format", () => {
    it("registers the canonical schema under the platform subject on connect", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        schemaRegistryUrl: "http://registry:8081",
      });

      expect(lastRegistryHost).toBe("http://registry:8081");
      expect(mockRegister).toHaveBeenCalledTimes(1);
      const [schema, opts] = mockRegister.mock.calls[0];
      expect(schema.type).toBe("AVRO");
      // schema is the canonical AVRO JSON string with the expected top-level name.
      expect(typeof schema.schema).toBe("string");
      const parsed = JSON.parse(schema.schema);
      expect(parsed.name).toBe("TelemetryLocationEvent");
      expect(parsed.namespace).toBe("telemetry.ingest");
      expect(opts).toEqual({ subject: TELEMETRY_LOCATION_AVRO_SUBJECT });
    });

    it("defaults schemaRegistryUrl to localhost:18081", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "canonical-avro" });
      expect(lastRegistryHost).toBe("http://localhost:18081");
    });

    it("encodes the canonical envelope and emits a Buffer-valued message", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        keyField: "device.id",
        fanOut: "metadata.devices",
        sourceService: "moveet-simulator",
        sourceEnvironment: "dev",
      });
      const fixTs = 1_700_000_000_000;
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: -1.2863,
          longitude: 36.8172,
          speed: 36, // km/h → 10 m/s
          heading: 90,
          accuracy: 12.5,
          timestamp: fixTs,
          metadata: { devices: [{ id: "d1", deviceType: "gps" }] },
        },
      ]);

      // encode() called with the cached schema id (7 from the mock).
      expect(mockEncode).toHaveBeenCalledTimes(1);
      expect(mockEncode.mock.calls[0][0]).toBe(7);
      const envelope = mockEncode.mock.calls[0][1] as Record<string, any>;

      // Envelope (top-level) shape.
      expect(envelope.event_type).toBe("telemetry.location.reported");
      expect(envelope.event_version).toBe(1);
      expect(typeof envelope.event_id).toBe("string");
      expect(typeof envelope.occurred_at).toBe("string");
      expect(envelope.source).toEqual({ service: "moveet-simulator", environment: "dev" });
      expect(envelope.metadata).toEqual({
        correlation_id: null,
        causation_id: null,
        trace_id: null,
      });

      // data payload (telemetry mapping).
      expect(envelope.data).toMatchObject({
        // device_id is context.id (the vehicle id); the Kafka key is device.id.
        device_id: "v1",
        source: "GPS",
        latitude: -1.2863,
        longitude: 36.8172,
        accuracy_meters: 12.5,
        speed_mps: 10,
        heading_degrees: 90,
        ignition_on: true,
        moving: true,
        satellites: null,
        battery_level: null,
        battery_charging: null,
        network: null,
        position_origin: null,
        sensor_readings: {},
      });
      expect(envelope.data.recorded_at).toBe(new Date(fixTs).toISOString());

      // Message: key resolved via keyField (device.id), value is the Buffer.
      const message = mockSend.mock.calls[0][0].messages[0];
      expect(message.key).toBe("d1");
      expect(Buffer.isBuffer(message.value)).toBe(true);
    });

    it("maps mobile devices to source=MOBILE", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        keyField: "device.id",
        fanOut: "metadata.devices",
      });
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: 0,
          longitude: 0,
          metadata: { devices: [{ id: "d2", deviceType: "mobile" }] },
        },
      ]);

      const envelope = mockEncode.mock.calls[0][1] as Record<string, any>;
      expect(envelope.data.source).toBe("MOBILE");
    });

    it("fans out one encoded message per device, keyed by device.id", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        keyField: "device.id",
        fanOut: "metadata.devices",
      });
      await sink.publishUpdates([
        {
          id: "v1",
          latitude: -1.28,
          longitude: 36.8,
          metadata: {
            devices: [
              { id: "d1", deviceType: "gps" },
              { id: "d2", deviceType: "mobile" },
            ],
          },
        },
      ]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(2);
      expect(messages.map((m: { key: string }) => m.key)).toEqual(["d1", "d2"]);
      expect(messages.every((m: { value: unknown }) => Buffer.isBuffer(m.value))).toBe(true);
      expect(mockEncode).toHaveBeenCalledTimes(2);
    });

    it("emits nothing for an update with no devices when fanOut is set", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        keyField: "device.id",
        fanOut: "metadata.devices",
      });
      await sink.publishUpdates([{ id: "v1", latitude: 0, longitude: 0 }]);

      expect(mockSend.mock.calls[0][0].messages).toHaveLength(0);
      expect(mockEncode).not.toHaveBeenCalled();
    });
  });

  describe("TLS + SASL", () => {
    const CA = "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----";
    const CERT = "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----";
    const KEY = "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----";

    it("omits ssl and sasl when not configured (plaintext back-compat)", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      expect(lastKafkaConfig).toBeDefined();
      expect(lastKafkaConfig).not.toHaveProperty("ssl");
      expect(lastKafkaConfig).not.toHaveProperty("sasl");
    });

    it("passes inline-PEM mutual TLS + SASL to the Kafka client", async () => {
      await sink.connect({
        brokers: "rp1:9093",
        tlsCa: CA,
        tlsCert: CERT,
        tlsKey: KEY,
        saslMechanism: "scram-sha-512",
        saslUsername: "flare-cc",
        saslPassword: "secret",
      });

      expect(lastKafkaConfig!.ssl).toEqual({
        ca: [CA],
        cert: CERT,
        key: KEY,
        rejectUnauthorized: true,
      });
      expect(lastKafkaConfig!.sasl).toEqual({
        mechanism: "scram-sha-512",
        username: "flare-cc",
        password: "secret",
      });
    });

    it("honours tlsRejectUnauthorized: false", async () => {
      await sink.connect({ brokers: "rp1:9093", tlsRejectUnauthorized: false });
      expect(lastKafkaConfig!.ssl).toEqual({ rejectUnauthorized: false });
    });

    it("defaults the SASL mechanism to PLAIN", async () => {
      await sink.connect({ brokers: "rp1:9093", saslUsername: "u", saslPassword: "p" });
      expect((lastKafkaConfig!.sasl as { mechanism: string }).mechanism).toBe("plain");
    });

    it("rejects an unsupported SASL mechanism", async () => {
      await expect(
        sink.connect({
          brokers: "rp1:9093",
          saslMechanism: "kerberos",
          saslUsername: "u",
          saslPassword: "p",
        })
      ).rejects.toThrow(/invalid saslMechanism/);
    });

    it("requires username and password when SASL is enabled", async () => {
      await expect(
        sink.connect({ brokers: "rp1:9093", saslMechanism: "scram-sha-512" })
      ).rejects.toThrow(/saslUsername and saslPassword are required/);
    });

    it("gives the Schema Registry an mTLS agent carrying the cert material", async () => {
      await sink.connect({
        brokers: "rp1:9093",
        format: "canonical-avro",
        schemaRegistryUrl: "https://rp1:8083",
        tlsCa: CA,
        tlsCert: CERT,
        tlsKey: KEY,
      });

      expect(lastRegistryArgs!.agent).toBeDefined();
      const agentOptions = (lastRegistryArgs!.agent as { options: Record<string, unknown> })
        .options;
      expect(agentOptions.ca).toEqual([CA]);
      expect(agentOptions.cert).toBe(CERT);
      expect(agentOptions.key).toBe(KEY);
    });

    it("creates no registry agent when TLS is not configured", async () => {
      await sink.connect({
        brokers: "localhost:9092",
        format: "canonical-avro",
        schemaRegistryUrl: "http://registry:8081",
      });
      expect(lastRegistryArgs!.agent).toBeUndefined();
    });
  });

  describe("configSchema", () => {
    it("includes acks in configSchema", () => {
      const acksField = sink.configSchema.find((f) => f.name === "acks");
      expect(acksField).toBeDefined();
      expect(acksField!.type).toBe("select");
      expect(acksField!.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "-1" }),
          expect.objectContaining({ value: "0" }),
          expect.objectContaining({ value: "1" }),
        ])
      );
    });
  });

  describe("healthCheck", () => {
    it("reports unhealthy when not connected", async () => {
      const result = await sink.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.message).toBe("producer not initialized");
    });

    it("reports healthy when broker responds to describeCluster", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain("cluster reachable");
      expect(result.message).toContain("1 broker");
      expect(mockAdminConnect).toHaveBeenCalled();
      expect(mockDescribeCluster).toHaveBeenCalled();
      expect(mockAdminDisconnect).toHaveBeenCalled();
    });

    it("reports unhealthy when broker is unreachable", async () => {
      mockDescribeCluster.mockRejectedValueOnce(
        new Error("Connection error: connect ECONNREFUSED 127.0.0.1:9092")
      );

      await sink.connect({ brokers: "localhost:9092" });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain("ECONNREFUSED");
    });

    it("reports unhealthy when admin connect fails", async () => {
      // Connect first (the topic-existence check uses admin.connect too), then
      // make the health check's admin.connect fail.
      await sink.connect({ brokers: "localhost:9092" });
      mockAdminConnect.mockRejectedValueOnce(
        new Error("KafkaJSConnectionError: broker unavailable")
      );

      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toContain("broker unavailable");
    });

    it("times out gracefully when broker hangs", async () => {
      mockDescribeCluster.mockImplementationOnce(
        () => new Promise(() => {}) // never resolves
      );

      // Use a very short timeout so the test completes quickly
      await sink.connect({ brokers: "localhost:9092", healthCheckTimeoutMs: 50 });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe("health check timed out");
    });

    it("reports latency in health check result", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      const result = await sink.healthCheck();

      expect(result.latencyMs).toBeDefined();
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports latency even when unhealthy", async () => {
      mockDescribeCluster.mockRejectedValueOnce(new Error("broker down"));

      await sink.connect({ brokers: "localhost:9092" });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.latencyMs).toBeDefined();
      expect(typeof result.latencyMs).toBe("number");
    });

    it("correctly reports broker count for multi-broker cluster", async () => {
      mockDescribeCluster.mockResolvedValueOnce({
        brokers: [
          { nodeId: 0, host: "broker1", port: 9092 },
          { nodeId: 1, host: "broker2", port: 9092 },
          { nodeId: 2, host: "broker3", port: 9092 },
        ],
        controller: 0,
        clusterId: "test-cluster",
      });

      await sink.connect({ brokers: "broker1:9092,broker2:9092,broker3:9092" });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.message).toContain("3 brokers");
    });

    it("disconnects admin client even when describeCluster fails", async () => {
      mockDescribeCluster.mockRejectedValueOnce(new Error("fail"));

      await sink.connect({ brokers: "localhost:9092" });
      await sink.healthCheck();

      expect(mockAdminDisconnect).toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import avro from "avsc";
import {
  RedpandaSink,
  TELEMETRY_LOCATION_AVRO_SCHEMA,
  TELEMETRY_LOCATION_AVRO_SCHEMA_PATH,
} from "./redpanda";

// This suite exercises the REAL avro codec (the `avsc` library, the same codec
// the Confluent Schema Registry uses under the hood) against the versioned
// `.avsc` artifact and the envelopes the sink actually emits. The redpanda unit
// suite asserts the pre-encode JSON shape against a MOCKED registry whose
// encode() never validates; that cannot catch a schema/payload mismatch (wrong
// type, missing required field, bad enum symbol). Encoding then decoding
// in-process here does — with no network and no live registry.

// Mock kafkajs so connect()/publishUpdates() run offline and we can capture the
// exact envelope the sink builds (the value passed to registry.encode()).
const mockSend = vi.fn().mockResolvedValue(undefined);
vi.mock("kafkajs", () => {
  class MockKafka {
    producer() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send: mockSend,
      };
    }
    admin() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        listTopics: vi.fn().mockResolvedValue(["dispatch.vehicle.positions"]),
        describeCluster: vi.fn(),
      };
    }
  }
  return { Kafka: MockKafka };
});

// The mock registry captures the envelope the sink emits but does NOT validate
// it (that is the whole gap this suite closes). The captured envelope is then
// fed to the real avsc codec below.
const captured: Record<string, unknown>[] = [];
const mockEncode = vi.fn(async (_id: number, payload: Record<string, unknown>) => {
  captured.push(payload);
  return Buffer.from("sentinel");
});
vi.mock("@kafkajs/confluent-schema-registry", () => {
  class MockSchemaRegistry {
    register = vi.fn().mockResolvedValue({ id: 7 });
    encode = mockEncode;
  }
  return {
    SchemaRegistry: MockSchemaRegistry,
    SchemaType: { AVRO: "AVRO", JSON: "JSON", PROTOBUF: "PROTOBUF", UNKNOWN: "UNKNOWN" },
  };
});

describe("canonical telemetry AVRO round-trip (real avsc codec)", () => {
  // The same schema object the sink registers, compiled by the real codec.
  const type = avro.Type.forSchema(TELEMETRY_LOCATION_AVRO_SCHEMA as avro.Schema);

  beforeEach(() => {
    captured.length = 0;
    vi.clearAllMocks();
  });

  it("loads the schema from the versioned .avsc artifact (parity with the exported object)", () => {
    const fromDisk = JSON.parse(readFileSync(TELEMETRY_LOCATION_AVRO_SCHEMA_PATH, "utf8"));
    expect(fromDisk).toEqual(TELEMETRY_LOCATION_AVRO_SCHEMA);
    expect(TELEMETRY_LOCATION_AVRO_SCHEMA_PATH).toMatch(/canonical-telemetry\.v1\.avsc$/);
    // The codec compiled the schema without throwing -> it is a valid AVRO schema.
    expect(type.name).toBe("telemetry.ingest.TelemetryLocationEvent");
  });

  it("round-trips an envelope the SINK builds, preserving the meaningful fields", async () => {
    const sink = new RedpandaSink();
    await sink.connect({
      brokers: "localhost:9092",
      format: "canonical-avro",
      keyField: "device.id",
      fanOut: "metadata.devices",
      sourceService: "moveet-simulator",
      sourceEnvironment: "prod",
    });
    const fixTs = 1_700_000_000_000;
    await sink.publishUpdates(
      [
        {
          id: "v1",
          latitude: -1.2863,
          longitude: 36.8172,
          speed: 36, // km/h -> 10 m/s
          heading: 90,
          accuracy: 12.5,
          timestamp: fixTs,
          metadata: { devices: [{ id: "d1", deviceType: "gps" }] },
        },
      ],
      { correlationId: "req-abc", traceId: "trace-xyz" }
    );

    expect(captured).toHaveLength(1);
    const envelope = captured[0];

    // Encode through the REAL codec (would throw on any schema/payload mismatch),
    // then decode and compare. This is the assertion the mocked registry cannot make.
    const buffer = type.toBuffer(envelope);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const decoded = type.fromBuffer(buffer) as typeof envelope & {
      source: Record<string, unknown>;
      metadata: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    // Top-level + nested record fields survive the round-trip unchanged.
    expect(decoded.event_type).toBe("telemetry.location.reported");
    expect(decoded.event_version).toBe(1);
    expect(decoded.source).toEqual({ service: "moveet-simulator", environment: "prod" });
    expect(decoded.metadata).toEqual({
      correlation_id: "req-abc",
      causation_id: null,
      trace_id: "trace-xyz",
    });
    expect(decoded.data).toMatchObject({
      device_id: "d1",
      source: "GPS",
      latitude: -1.2863,
      longitude: 36.8172,
      accuracy_meters: 12.5,
      speed_mps: 10,
      heading_degrees: 90,
      ignition_on: true,
      moving: true,
      // schema-default nullable fields the simulator cannot supply
      satellites: null,
      battery_level: null,
      network: null,
      position_origin: null,
      sensor_readings: {},
    });
    expect(decoded.data.recorded_at).toBe(new Date(fixTs).toISOString());

    // The whole envelope is byte-stable: decoded === input for every field.
    expect(decoded).toEqual(envelope);
  });

  it("round-trips a mobile, no-fan-out envelope (source=MOBILE, null correlation)", async () => {
    const sink = new RedpandaSink();
    await sink.connect({
      brokers: "localhost:9092",
      format: "canonical-avro",
      keyField: "id",
    });
    await sink.publishUpdates([
      { id: "m9", latitude: 0, longitude: 0, speed: 0, metadata: { deviceType: "mobile" } },
    ]);

    const envelope = captured[0];
    const decoded = type.fromBuffer(type.toBuffer(envelope)) as Record<string, any>;
    expect(decoded.data.device_id).toBe("m9");
    expect(decoded.data.source).toBe("MOBILE");
    expect(decoded.data.moving).toBe(false);
    expect(decoded.metadata).toEqual({
      correlation_id: null,
      causation_id: null,
      trace_id: null,
    });
    expect(decoded).toEqual(envelope);
  });

  it("rejects a deliberately wrong-typed payload at encode time", () => {
    const valid = {
      event_id: "e1",
      event_type: "telemetry.location.reported",
      event_version: 1,
      occurred_at: "2026-01-01T00:00:00.000Z",
      source: { service: "svc", environment: "dev" },
      metadata: { correlation_id: null, causation_id: null, trace_id: null },
      data: {
        device_id: "d1",
        source: "GPS",
        recorded_at: "2026-01-01T00:00:00.000Z",
        latitude: -1.28,
        longitude: 36.8,
        accuracy_meters: 5,
        speed_mps: 10,
        heading_degrees: 90,
        altitude_meters: 0,
        satellites: null,
        ignition_on: true,
        moving: true,
        battery_level: null,
        battery_charging: null,
        network: null,
        position_origin: null,
        sensor_readings: {},
      },
    };
    // Sanity: the valid baseline encodes.
    expect(() => type.toBuffer(valid)).not.toThrow();

    // event_version must be an int, not a string.
    expect(() => type.toBuffer({ ...valid, event_version: "not-an-int" })).toThrow(/invalid "int"/);

    // latitude must be a double, not a string.
    expect(() => type.toBuffer({ ...valid, data: { ...valid.data, latitude: "nope" } })).toThrow(
      /invalid/
    );

    // source is an enum: an unknown symbol is not encodable.
    expect(() => type.toBuffer({ ...valid, data: { ...valid.data, source: "SATELLITE" } })).toThrow(
      /invalid/
    );

    // device_id is required (non-null): omitting it fails.
    const { device_id: _omit, ...dataMissingId } = valid.data;
    expect(() => type.toBuffer({ ...valid, data: dataMissingId })).toThrow(/invalid/);
  });
});

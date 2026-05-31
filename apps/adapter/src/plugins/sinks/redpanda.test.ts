import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedpandaSink } from "./redpanda";
import { fleetRoster } from "../fleetRoster";

// Mock kafkajs so we can intercept producer.send() and admin calls
const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

const mockAdminConnect = vi.fn().mockResolvedValue(undefined);
const mockAdminDisconnect = vi.fn().mockResolvedValue(undefined);
const mockDescribeCluster = vi.fn().mockResolvedValue({
  brokers: [{ nodeId: 0, host: "localhost", port: 9092 }],
  controller: 0,
  clusterId: "test-cluster",
});

vi.mock("kafkajs", () => {
  class MockKafka {
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
        describeCluster: mockDescribeCluster,
      };
    }
  }
  return { Kafka: MockKafka };
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

    it("normalizes heading into [0, 360) and synthesizes missing fields", async () => {
      await sink.connect({ brokers: "localhost:9092", format: "trajectory" });
      await sink.publishUpdates([{ id: "1", latitude: 0, longitude: 0, heading: 450 }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.heading).toBe(90); // 450 mod 360
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

    it("rejects an invalid keyBy value", async () => {
      await expect(
        sink.connect({ brokers: "localhost:9092", format: "trajectory", keyBy: "bogus" })
      ).rejects.toThrow(/invalid keyBy/);
    });

    it("still emits the native dispatch shape by default", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8, type: "car" }]);

      const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
      expect(payload.eventType).toBe("vehicle.position");
      expect(payload.vehicleId).toBe("v1");
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

  describe("trajectory format keyed by connector device id", () => {
    beforeEach(() => {
      fleetRoster.clear();
    });

    it("fans an update out to each bound device, keyed by the real device id", async () => {
      // Vehicle V1 has both a fitted_gps and a shift device bound.
      fleetRoster.applyAssignment("dev-gps-1", "V1", "fitted_gps");
      fleetRoster.applyAssignment("dev-shift-1", "V1", "shift");

      await sink.connect({ brokers: "localhost:9092", format: "trajectory", keyBy: "deviceId" });
      await sink.publishUpdates([{ id: "V1", latitude: -1.3, longitude: 36.8, speed: 36 }]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(2);

      const byKey = Object.fromEntries(messages.map((m: { key: string }) => [m.key, m]));
      expect(Object.keys(byKey).sort()).toEqual(["dev-gps-1", "dev-shift-1"]);

      // Payload carries the real device id as a string; no vehicleId (the engine
      // resolves deviceId → vehicleId itself via assignment events).
      const gpsPayload = JSON.parse(byKey["dev-gps-1"].value);
      const shiftPayload = JSON.parse(byKey["dev-shift-1"].value);
      expect(gpsPayload.deviceId).toBe("dev-gps-1");
      expect(shiftPayload.deviceId).toBe("dev-shift-1");
      expect(gpsPayload).not.toHaveProperty("vehicleId");
      expect(shiftPayload).not.toHaveProperty("vehicleId");
      // GPS transforms still apply.
      expect(gpsPayload.speed).toBe(10);
      expect(gpsPayload.lat).toBe(-1.3);
    });

    it("emits nothing for a vehicle with no currently-bound device (unbind)", async () => {
      fleetRoster.applyAssignment("dev-1", "V1", "fitted_gps");
      fleetRoster.applyAssignment("dev-1", null, "fitted_gps"); // unbind

      await sink.connect({ brokers: "localhost:9092", format: "trajectory", keyBy: "deviceId" });
      await sink.publishUpdates([{ id: "V1", latitude: 0, longitude: 0, speed: 10 }]);

      const messages = mockSend.mock.calls[0][0].messages;
      expect(messages).toHaveLength(0);
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
      mockAdminConnect.mockRejectedValueOnce(
        new Error("KafkaJSConnectionError: broker unavailable")
      );

      await sink.connect({ brokers: "localhost:9092" });
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

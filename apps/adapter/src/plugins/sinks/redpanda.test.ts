import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedpandaSink } from "./redpanda";

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
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
      ]);

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
        { id: "v3", latitude: -1.30, longitude: 36.82 },
      ]);

      const sentMessages = mockSend.mock.calls[0][0].messages;
      const eventIds = sentMessages.map(
        (m: { value: string }) => JSON.parse(m.value).eventId
      );

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
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
      ]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ acks: 1 })
      );
    });

    it("respects acks: -1 for full ISR acknowledgement", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: -1 });
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
      ]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ acks: -1 })
      );
    });

    it("respects acks: 0 for fire-and-forget", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: 0 });
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
      ]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ acks: 0 })
      );
    });

    it("handles string acks values from select config field", async () => {
      await sink.connect({ brokers: "localhost:9092", acks: "-1" });
      await sink.publishUpdates([
        { id: "v1", latitude: -1.28, longitude: 36.8 },
      ]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ acks: -1 })
      );
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

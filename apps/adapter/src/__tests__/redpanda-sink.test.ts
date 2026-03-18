import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockProducerConnect = vi.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = vi.fn().mockResolvedValue(undefined);
const mockAdminConnect = vi.fn().mockResolvedValue(undefined);
const mockAdminDisconnect = vi.fn().mockResolvedValue(undefined);
const mockDescribeCluster = vi.fn().mockResolvedValue({
  brokers: [{ nodeId: 0, host: "localhost", port: 9092 }],
  controller: 0,
  clusterId: "test-cluster",
});

vi.mock("kafkajs", () => ({
  Kafka: class MockKafka {
    constructor() {}
    producer() {
      return {
        connect: mockProducerConnect,
        disconnect: mockProducerDisconnect,
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
  },
}));

import { RedpandaSink } from "../plugins/sinks/redpanda";

describe("RedpandaSink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type and name", () => {
    const sink = new RedpandaSink();
    expect(sink.type).toBe("redpanda");
    expect(sink.name).toBe("Redpanda/Kafka Message Broker");
  });

  it("connects to kafka and publishes updates", async () => {
    const sink = new RedpandaSink();
    await sink.connect({ brokers: "localhost:9092", topic: "test-topic" });

    expect(mockProducerConnect).toHaveBeenCalled();

    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockSend).toHaveBeenCalledWith({
      topic: "test-topic",
      messages: expect.arrayContaining([
        expect.objectContaining({
          key: "v1",
          value: expect.stringContaining("vehicle.position"),
        }),
      ]),
      acks: 1,
    });
  });

  it("uses default brokers and topic", async () => {
    const sink = new RedpandaSink();
    await sink.connect({});
    const health = await sink.healthCheck();
    expect(health).toMatchObject({ healthy: true });
    expect(health.latencyMs).toBeDefined();
    expect(typeof health.latencyMs).toBe("number");
  });

  it("disconnects producer", async () => {
    const sink = new RedpandaSink();
    await sink.connect({});
    await sink.disconnect();
    expect(mockProducerDisconnect).toHaveBeenCalled();
  });

  it("has config schema with batchSize field", () => {
    const sink = new RedpandaSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "brokers")).toBeDefined();
    expect(sink.configSchema.find((f) => f.name === "topic")).toBeDefined();
    const batchSizeField = sink.configSchema.find((f) => f.name === "batchSize");
    expect(batchSizeField).toBeDefined();
    expect(batchSizeField!.type).toBe("number");
    expect(batchSizeField!.default).toBe(500);
  });

  it("sends all messages in a single call when under batchSize", async () => {
    const sink = new RedpandaSink();
    await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

    const updates = Array.from({ length: 100 }, (_, i) => ({
      id: `v${i}`,
      latitude: -1.3 + i * 0.001,
      longitude: 36.8 + i * 0.001,
    }));

    await sink.publishUpdates(updates);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "test-topic",
        messages: expect.any(Array),
        acks: 1,
      })
    );
    expect(mockSend.mock.calls[0][0].messages).toHaveLength(100);
  });

  it("chunks messages into batches when exceeding batchSize", async () => {
    const sink = new RedpandaSink();
    await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

    const updates = Array.from({ length: 1200 }, (_, i) => ({
      id: `v${i}`,
      latitude: -1.3 + i * 0.0001,
      longitude: 36.8 + i * 0.0001,
    }));

    await sink.publishUpdates(updates);

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[0][0].messages).toHaveLength(500);
    expect(mockSend.mock.calls[1][0].messages).toHaveLength(500);
    expect(mockSend.mock.calls[2][0].messages).toHaveLength(200);

    for (const call of mockSend.mock.calls) {
      expect(call[0].acks).toBe(1);
      expect(call[0].topic).toBe("test-topic");
    }
  });

  describe("partial failure handling (chunked publishing)", () => {
    it("returns success result when all chunks succeed", async () => {
      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 1200 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.0001,
        longitude: 36.8 + i * 0.0001,
      }));

      const result = await sink.publishUpdates(updates);

      expect(result).toEqual({
        attempted: 1200,
        succeeded: 1200,
        failures: [],
      });
    });

    it("returns partial success with details when some chunks fail", async () => {
      // Chunk 0 succeeds, chunk 1 fails, chunk 2 succeeds
      mockSend
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("broker unavailable"))
        .mockResolvedValueOnce(undefined);

      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 1200 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.0001,
        longitude: 36.8 + i * 0.0001,
      }));

      const result = await sink.publishUpdates(updates);

      expect(result).toEqual({
        attempted: 1200,
        succeeded: 700,
        failures: [{ itemId: "chunk-1", error: "broker unavailable" }],
      });
    });

    it("throws when all chunks fail", async () => {
      mockSend
        .mockRejectedValueOnce(new Error("broker down"))
        .mockRejectedValueOnce(new Error("broker down"))
        .mockRejectedValueOnce(new Error("broker down"));

      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 1200 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.0001,
        longitude: 36.8 + i * 0.0001,
      }));

      await expect(sink.publishUpdates(updates)).rejects.toThrow("All 3 chunks failed to publish");
    });

    it("does not use chunked path for messages under batchSize (no partial failure)", async () => {
      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 100 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.001,
        longitude: 36.8 + i * 0.001,
      }));

      const result = await sink.publishUpdates(updates);

      // Single send path returns void (no chunking)
      expect(result).toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});

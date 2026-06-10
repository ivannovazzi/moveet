import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockProducerConnect = vi.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = vi.fn().mockResolvedValue(undefined);
const mockAdminConnect = vi.fn().mockResolvedValue(undefined);
const mockAdminDisconnect = vi.fn().mockResolvedValue(undefined);
const mockListTopics = vi
  .fn()
  .mockResolvedValue(["test-topic", "dispatch.vehicle.positions", "vehicles"]);
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
        listTopics: mockListTopics,
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

  describe("acks validation", () => {
    it.each([0, 1, -1])("accepts valid acks value %s", async (acks) => {
      const sink = new RedpandaSink();
      await expect(sink.connect({ acks })).resolves.toBeUndefined();
    });

    it.each([2, "all", "x"])("rejects invalid acks value %s", async (acks) => {
      const sink = new RedpandaSink();
      await expect(sink.connect({ acks })).rejects.toThrow(/acks/i);
    });
  });

  describe("topic existence check on connect", () => {
    it("fails fast with a clear error naming the topic when it does not exist", async () => {
      mockListTopics.mockResolvedValueOnce(["some-other-topic"]);

      const sink = new RedpandaSink();
      await expect(sink.connect({ topic: "missing-topic" })).rejects.toThrow(
        /topic "missing-topic" does not exist/
      );

      // The half-connected producer and the admin client are both torn down.
      expect(mockProducerDisconnect).toHaveBeenCalled();
      expect(mockAdminDisconnect).toHaveBeenCalled();
    });

    it("connects successfully when the topic exists", async () => {
      const sink = new RedpandaSink();
      await expect(sink.connect({ topic: "test-topic" })).resolves.toBeUndefined();
      expect(mockListTopics).toHaveBeenCalled();
      expect(mockAdminDisconnect).toHaveBeenCalled();
    });
  });

  describe("connect failure cleanup", () => {
    it("disconnects and clears the producer when producer.connect() fails", async () => {
      mockProducerConnect.mockRejectedValueOnce(new Error("broker unreachable"));

      const sink = new RedpandaSink();
      await expect(sink.connect({})).rejects.toThrow("broker unreachable");

      // The half-connected producer must be torn down, not leaked.
      expect(mockProducerDisconnect).toHaveBeenCalled();

      // A subsequent publish must be a no-op (producer was cleared), not a throw.
      await expect(
        sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }])
      ).resolves.toBeUndefined();
    });
  });

  describe("health check timeout", () => {
    it("returns unhealthy when admin.connect() hangs past the timeout", async () => {
      const sink = new RedpandaSink();
      await sink.connect({ topic: "test-topic", healthCheckTimeoutMs: 50 });

      // Subsequent admin.connect (the health check's) never settles.
      mockAdminConnect.mockImplementationOnce(() => new Promise(() => {}));

      const health = await sink.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("timed out");
      // The hung admin client is still cleaned up.
      expect(mockAdminDisconnect).toHaveBeenCalled();
    });

    it("returns unhealthy when describeCluster() hangs past the timeout", async () => {
      const sink = new RedpandaSink();
      await sink.connect({ topic: "test-topic", healthCheckTimeoutMs: 50 });

      mockDescribeCluster.mockImplementationOnce(() => new Promise(() => {}));

      const health = await sink.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("timed out");
    });
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

    it("stops sending after the first failed chunk so retries can't reorder messages", async () => {
      // Chunk 0 succeeds, chunk 1 fails → chunk 2 must NOT be attempted.
      mockSend
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("broker unavailable"));

      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 1200 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.0001,
        longitude: 36.8 + i * 0.0001,
      }));

      const result = await sink.publishUpdates(updates);

      // Only chunks 0 and 1 were sent; the batch aborted before chunk 2.
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        attempted: 1200,
        succeeded: 500,
        failures: [
          { itemId: "chunk-1", error: "broker unavailable" },
          { itemId: "chunk-2", error: "not attempted (batch aborted after chunk 1 failed)" },
        ],
      });
    });

    it("throws when no chunk is delivered (first chunk fails, remainder aborted)", async () => {
      mockSend.mockRejectedValueOnce(new Error("broker down"));

      const sink = new RedpandaSink();
      await sink.connect({ brokers: "localhost:9092", topic: "test-topic", batchSize: 500 });

      const updates = Array.from({ length: 1200 }, (_, i) => ({
        id: `v${i}`,
        latitude: -1.3 + i * 0.0001,
        longitude: 36.8 + i * 0.0001,
      }));

      await expect(sink.publishUpdates(updates)).rejects.toThrow(
        "First chunk failed to publish; 2 remaining chunk(s) aborted to preserve ordering"
      );
      // Sends are sequential and abort on first failure: only one attempt.
      expect(mockSend).toHaveBeenCalledTimes(1);
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

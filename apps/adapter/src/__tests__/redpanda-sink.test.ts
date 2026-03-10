import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue(undefined);
const mockProducerConnect = vi.fn().mockResolvedValue(undefined);
const mockProducerDisconnect = vi.fn().mockResolvedValue(undefined);

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
    });
  });

  it("uses default brokers and topic", async () => {
    const sink = new RedpandaSink();
    await sink.connect({});
    expect(await sink.healthCheck()).toMatchObject({ healthy: true });
  });

  it("disconnects producer", async () => {
    const sink = new RedpandaSink();
    await sink.connect({});
    await sink.disconnect();
    expect(mockProducerDisconnect).toHaveBeenCalled();
  });

  it("has config schema", () => {
    const sink = new RedpandaSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "brokers")).toBeDefined();
    expect(sink.configSchema.find((f) => f.name === "topic")).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPublish = vi.fn().mockResolvedValue(1);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue("OK");
const mockPing = vi.fn().mockResolvedValue("PONG");

vi.mock("ioredis", () => ({
  default: class MockRedis {
    connect = mockConnect;
    quit = mockQuit;
    publish = mockPublish;
    ping = mockPing;
    constructor() {}
  },
}));

import { RedisPubSubSink } from "../plugins/sinks/redis";

describe("RedisPubSubSink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type and name", () => {
    const sink = new RedisPubSubSink();
    expect(sink.type).toBe("redis");
    expect(sink.name).toBe("Redis Pub/Sub");
  });

  it("connects and publishes updates", async () => {
    const sink = new RedisPubSubSink();
    await sink.connect({ host: "localhost", port: 6379 });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockPublish).toHaveBeenCalledWith(
      "moveet:vehicle-updates",
      expect.stringContaining("v1")
    );
  });

  it("uses custom channel", async () => {
    const sink = new RedisPubSubSink();
    await sink.connect({ host: "localhost", channel: "my:channel" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockPublish).toHaveBeenCalledWith("my:channel", expect.any(String));
  });

  it("disconnects cleanly", async () => {
    const sink = new RedisPubSubSink();
    await sink.connect({ host: "localhost" });
    await sink.disconnect();
    expect(mockQuit).toHaveBeenCalled();
  });

  it("has config schema", () => {
    const sink = new RedisPubSubSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "host")).toBeDefined();
    expect(sink.configSchema.find((f) => f.name === "channel")).toBeDefined();
  });
});

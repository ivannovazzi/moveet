import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedpandaSink } from "./redpanda";

// Mock kafkajs so we can intercept producer.send() calls
const mockSend = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("kafkajs", () => {
  class MockKafka {
    producer() {
      return {
        connect: mockConnect,
        disconnect: mockDisconnect,
        send: mockSend,
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
    });

    it("reports healthy when connected", async () => {
      await sink.connect({ brokers: "localhost:9092" });
      const result = await sink.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });
});

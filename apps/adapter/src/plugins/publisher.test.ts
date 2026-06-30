import { describe, it, expect, vi } from "vitest";
import { Publisher } from "./publisher";
import type { DataSink, SinkPublishResult } from "./types";
import type { VehicleUpdate } from "../types";
import { metrics } from "../metrics";

/** Read the current value of a sink-delivery counter cell (0 when absent). */
async function deliveryCount(sink: string, outcome: string): Promise<number> {
  const json = await metrics.sinkDeliveries.get();
  const cell = json.values.find((v) => v.labels.sink === sink && v.labels.outcome === outcome);
  return cell?.value ?? 0;
}

function createMockSink(overrides?: Partial<DataSink>): DataSink {
  return {
    type: "mock-sink",
    name: "Mock Sink",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    publishUpdates: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

const sampleUpdates: VehicleUpdate[] = [
  { id: "v1", latitude: -1.28, longitude: 36.8 },
  { id: "v2", latitude: -1.3, longitude: 36.82 },
];

describe("Publisher", () => {
  const publisher = new Publisher();

  describe("success scenarios", () => {
    it("returns success when all sinks succeed", async () => {
      const sinks = new Map<string, DataSink>([
        ["console", createMockSink()],
        ["webhook", createMockSink()],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("success");
      expect(result.sinks).toEqual([
        { type: "console", success: true },
        { type: "webhook", success: true },
      ]);
    });

    it("returns success with empty sinks array when no sinks configured", async () => {
      const result = await publisher.publishUpdates(sampleUpdates, new Map());

      expect(result.status).toBe("success");
      expect(result.sinks).toEqual([]);
    });

    it("passes updates to each sink", async () => {
      const sink1 = createMockSink();
      const sink2 = createMockSink();
      const sinks = new Map<string, DataSink>([
        ["s1", sink1],
        ["s2", sink2],
      ]);

      await publisher.publishUpdates(sampleUpdates, sinks);

      expect(sink1.publishUpdates).toHaveBeenCalledWith(sampleUpdates);
      expect(sink2.publishUpdates).toHaveBeenCalledWith(sampleUpdates);
    });
  });

  describe("partial failure", () => {
    it("returns partial when some sinks fail", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "fail",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(new Error("network error")),
          }),
        ],
        ["ok", createMockSink()],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("partial");
      expect(result.sinks).toContainEqual({
        type: "fail",
        success: false,
        error: "network error",
      });
      expect(result.sinks).toContainEqual({ type: "ok", success: true });
    });

    it("continues publishing to remaining sinks even when one errors", async () => {
      const okSink = createMockSink();
      const sinks = new Map<string, DataSink>([
        [
          "fail",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(new Error("fail")),
          }),
        ],
        ["ok", okSink],
      ]);

      await publisher.publishUpdates(sampleUpdates, sinks);

      expect(okSink.publishUpdates).toHaveBeenCalledWith(sampleUpdates);
    });
  });

  describe("total failure", () => {
    it("returns failure when all sinks fail", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "f1",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(new Error("err1")),
          }),
        ],
        [
          "f2",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(new Error("err2")),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("failure");
      expect(result.sinks).toContainEqual({ type: "f1", success: false, error: "err1" });
      expect(result.sinks).toContainEqual({ type: "f2", success: false, error: "err2" });
    });

    it("returns failure when single sink fails", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "only",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(new Error("boom")),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("failure");
    });
  });

  describe("error handling", () => {
    it("converts non-Error throws to string in error field", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "weird",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue("string error"),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.sinks[0].error).toBe("string error");
    });

    it("converts numeric throws to string in error field", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "weird",
          createMockSink({
            publishUpdates: vi.fn().mockRejectedValue(42),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.sinks[0].error).toBe("42");
    });
  });

  describe("sink partial-failure metadata", () => {
    it("marks sink as failed when it returns partial failures and includes details", async () => {
      const partialResult: SinkPublishResult = {
        attempted: 3,
        succeeded: 2,
        failures: [{ itemId: "v2", error: "connection refused" }],
      };
      const sinks = new Map<string, DataSink>([
        [
          "rest",
          createMockSink({
            publishUpdates: vi.fn().mockResolvedValue(partialResult),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("failure");
      expect(result.sinks[0]).toEqual({
        type: "rest",
        success: false,
        error: "1 of 3 items failed",
        failures: [{ itemId: "v2", error: "connection refused" }],
        attempted: 3,
        succeeded: 2,
      });
    });

    it("marks sink as successful when it returns metadata with no failures", async () => {
      const fullSuccess: SinkPublishResult = {
        attempted: 3,
        succeeded: 3,
        failures: [],
      };
      const sinks = new Map<string, DataSink>([
        [
          "rest",
          createMockSink({
            publishUpdates: vi.fn().mockResolvedValue(fullSuccess),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("success");
      expect(result.sinks[0]).toEqual({
        type: "rest",
        success: true,
        attempted: 3,
        succeeded: 3,
      });
    });

    it("reports partial at publisher level when one sink has item failures and another succeeds", async () => {
      const partialResult: SinkPublishResult = {
        attempted: 2,
        succeeded: 1,
        failures: [{ itemId: "v1", error: "timeout" }],
      };

      const sinks = new Map<string, DataSink>([
        [
          "rest",
          createMockSink({
            publishUpdates: vi.fn().mockResolvedValue(partialResult),
          }),
        ],
        ["console", createMockSink()],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("partial");
      const restSink = result.sinks.find((s) => s.type === "rest")!;
      expect(restSink.success).toBe(false);
      expect(restSink.failures).toHaveLength(1);

      const consoleSink = result.sinks.find((s) => s.type === "console")!;
      expect(consoleSink.success).toBe(true);
    });

    it("mirrors success and dropped counts onto the delivery metrics", async () => {
      const before = {
        success: await deliveryCount("metrics-sink", "success"),
        drop: await deliveryCount("metrics-sink", "drop"),
      };
      const partial: SinkPublishResult = {
        attempted: 10,
        succeeded: 7,
        failures: [{ itemId: "chunk-1", error: "broker down" }],
      };
      const sinks = new Map<string, DataSink>([
        ["metrics-sink", createMockSink({ publishUpdates: vi.fn().mockResolvedValue(partial) })],
      ]);

      await publisher.publishUpdates(sampleUpdates, sinks);

      // 7 delivered → success+7; (10-7)=3 undelivered → drop+3.
      expect(await deliveryCount("metrics-sink", "success")).toBe(before.success + 7);
      expect(await deliveryCount("metrics-sink", "drop")).toBe(before.drop + 3);
    });

    it("records a whole-sink throw as a failure on the delivery metrics", async () => {
      const before = await deliveryCount("throwing-sink", "failure");
      const sinks = new Map<string, DataSink>([
        [
          "throwing-sink",
          createMockSink({ publishUpdates: vi.fn().mockRejectedValue(new Error("boom")) }),
        ],
      ]);

      await publisher.publishUpdates(sampleUpdates, sinks);

      expect(await deliveryCount("throwing-sink", "failure")).toBe(before + 1);
    });

    it("forwards the publish context to sinks when provided", async () => {
      const sink = createMockSink();
      const sinks = new Map<string, DataSink>([["ctx-sink", sink]]);
      const context = { correlationId: "req-1", traceId: "req-1" };

      await publisher.publishUpdates(sampleUpdates, sinks, context);

      expect(sink.publishUpdates).toHaveBeenCalledWith(sampleUpdates, context);
    });

    it("treats sink returning void (no metadata) as success", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "console",
          createMockSink({
            publishUpdates: vi.fn().mockResolvedValue(undefined),
          }),
        ],
      ]);

      const result = await publisher.publishUpdates(sampleUpdates, sinks);

      expect(result.status).toBe("success");
      expect(result.sinks[0]).toEqual({ type: "console", success: true });
    });
  });
});

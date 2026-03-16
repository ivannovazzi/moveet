import { describe, it, expect, vi } from "vitest";
import { Publisher } from "./publisher";
import type { DataSink } from "./types";
import type { VehicleUpdate } from "../types";

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
  { id: "v2", latitude: -1.30, longitude: 36.82 },
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
});

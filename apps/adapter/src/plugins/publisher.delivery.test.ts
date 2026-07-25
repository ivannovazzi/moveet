import { describe, it, expect, vi } from "vitest";
import { Publisher } from "./publisher";
import type { DataSink, SinkPublishResult } from "./types";
import type { VehicleUpdate } from "../types";
import { metrics } from "../metrics";

/**
 * Delivery-hardening behaviour of the Publisher: the opt-in outbox/DLQ and the
 * per-sink circuit breaker. The plain at-most-once path is covered by
 * publisher.test.ts; the first block here asserts that path is untouched when
 * the outbox is off.
 */

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

const updates: VehicleUpdate[] = [
  { id: "v1", latitude: -1.28, longitude: 36.8 },
  { id: "v2", latitude: -1.3, longitude: 36.82 },
];

async function deliveryCount(sink: string, outcome: string): Promise<number> {
  const json = await metrics.sinkDeliveries.get();
  return (
    json.values.find((v) => v.labels.sink === sink && v.labels.outcome === outcome)?.value ?? 0
  );
}

async function redeliveredCount(sink: string): Promise<number> {
  const json = await metrics.outboxRedelivered.get();
  return json.values.find((v) => v.labels.sink === sink)?.value ?? 0;
}

describe("Publisher delivery hardening", () => {
  describe("outbox disabled (default)", () => {
    it("buffers nothing and returns the unchanged at-most-once result shape", async () => {
      const publisher = new Publisher();
      const sink = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("broker down")),
      });

      const result = await publisher.publishUpdates(updates, new Map([["off-sink", sink]]));

      expect(publisher.isOutboxEnabled()).toBe(false);
      // Exactly the historical shape: no `buffered` key.
      expect(result.sinks[0]).toEqual({
        type: "off-sink",
        success: false,
        error: "broker down",
      });
      expect(publisher.pendingOutbox()).toEqual({});
    });

    it("has nothing to flush, so a recovered sink receives no replay", async () => {
      const publisher = new Publisher();
      const sink = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("broker down")),
      });
      await publisher.publishUpdates(updates, new Map([["off-replay", sink]]));

      const recovered = createMockSink();
      const flushed = await publisher.flushOutbox("off-replay", recovered);

      expect(flushed).toEqual({ redelivered: 0, requeued: 0, dropped: 0 });
      expect(recovered.publishUpdates).not.toHaveBeenCalled();
    });
  });

  describe("outbox enabled", () => {
    it("buffers a failed batch and redelivers it once the sink recovers", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("broker down")),
      });

      const result = await publisher.publishUpdates(updates, new Map([["ob-sink", failing]]));

      expect(result.sinks[0].buffered).toBe(2);
      expect(publisher.pendingOutbox()).toEqual({ "ob-sink": 2 });

      const recovered = createMockSink();
      const before = await redeliveredCount("ob-sink");
      const flushed = await publisher.flushOutbox("ob-sink", recovered);

      expect(flushed).toEqual({ redelivered: 2, requeued: 0, dropped: 0 });
      expect(recovered.publishUpdates).toHaveBeenCalledWith(updates);
      expect(publisher.pendingOutbox()).toEqual({});
      expect(await redeliveredCount("ob-sink")).toBe(before + 2);
    });

    it("preserves the publish context across redelivery", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      const context = { correlationId: "req-7", traceId: "req-7" };

      await publisher.publishUpdates(updates, new Map([["ob-ctx", failing]]), context);
      const recovered = createMockSink();
      await publisher.flushOutbox("ob-ctx", recovered);

      expect(recovered.publishUpdates).toHaveBeenCalledWith(updates, context);
    });

    it("redelivers batches oldest-first", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      const sinks = new Map([["ob-order", failing]]);
      const first: VehicleUpdate[] = [{ id: "first", latitude: 0, longitude: 0 }];
      const second: VehicleUpdate[] = [{ id: "second", latitude: 0, longitude: 0 }];

      await publisher.publishUpdates(first, sinks);
      await publisher.publishUpdates(second, sinks);

      const recovered = createMockSink();
      await publisher.flushOutbox("ob-order", recovered);

      const calls = (recovered.publishUpdates as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.map((c) => (c[0] as VehicleUpdate[])[0].id)).toEqual(["first", "second"]);
    });

    it("buffers a partially-failed publish whole (duplicates on redelivery)", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true, retryPartial: true } });
      const partial: SinkPublishResult = {
        attempted: 2,
        succeeded: 1,
        failures: [{ itemId: "chunk-1", error: "broker down" }],
      };
      const sink = createMockSink({ publishUpdates: vi.fn().mockResolvedValue(partial) });

      const result = await publisher.publishUpdates(updates, new Map([["ob-partial", sink]]));

      expect(result.sinks[0].buffered).toBe(2);
      expect(publisher.pendingOutbox()).toEqual({ "ob-partial": 2 });
    });

    it("leaves partial failures alone when retryPartial is off", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true, retryPartial: false } });
      const partial: SinkPublishResult = {
        attempted: 2,
        succeeded: 1,
        failures: [{ itemId: "chunk-1", error: "broker down" }],
      };
      const sink = createMockSink({ publishUpdates: vi.fn().mockResolvedValue(partial) });

      await publisher.publishUpdates(updates, new Map([["ob-nopartial", sink]]));

      expect(publisher.pendingOutbox()).toEqual({});
    });

    it("stops the flush at the first still-failing batch and requeues the rest", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      const sinks = new Map([["ob-abort", failing]]);
      await publisher.publishUpdates(updates, sinks);
      await publisher.publishUpdates(updates, sinks);

      const stillDown = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("still down")),
      });
      const flushed = await publisher.flushOutbox("ob-abort", stillDown);

      // One attempt, not four: a dead sink is not marched through the queue.
      expect(stillDown.publishUpdates).toHaveBeenCalledTimes(1);
      expect(flushed).toEqual({ redelivered: 0, requeued: 4, dropped: 0 });
      expect(publisher.pendingOutbox()).toEqual({ "ob-abort": 4 });
    });

    it("drops a poison batch after maxAttempts and reports it as a drop", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true, maxAttempts: 2 } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      await publisher.publishUpdates(updates, new Map([["ob-poison", failing]]));
      const beforeDrops = await deliveryCount("ob-poison", "drop");

      const stillDown = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("still down")),
      });
      const first = await publisher.flushOutbox("ob-poison", stillDown);
      expect(first).toEqual({ redelivered: 0, requeued: 2, dropped: 0 });

      const second = await publisher.flushOutbox("ob-poison", stillDown);

      expect(second).toEqual({ redelivered: 0, requeued: 0, dropped: 2 });
      expect(publisher.pendingOutbox()).toEqual({});
      expect(await deliveryCount("ob-poison", "drop")).toBe(beforeDrops + 2);
    });

    it("treats a partial result during redelivery as a failed redelivery", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      await publisher.publishUpdates(updates, new Map([["ob-flushpartial", failing]]));

      const halfBroken = createMockSink({
        publishUpdates: vi.fn().mockResolvedValue({
          attempted: 2,
          succeeded: 1,
          failures: [{ itemId: "chunk-0", error: "nope" }],
        } satisfies SinkPublishResult),
      });
      const flushed = await publisher.flushOutbox("ob-flushpartial", halfBroken);

      expect(flushed.redelivered).toBe(0);
      expect(publisher.pendingOutbox()).toEqual({ "ob-flushpartial": 2 });
    });

    it("enforces the buffer bound with drop-oldest across publishes", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true, maxEntries: 2 } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      const sinks = new Map([["ob-bound", failing]]);

      for (const id of ["a", "b", "c"]) {
        await publisher.publishUpdates([{ id, latitude: 0, longitude: 0 }], sinks);
      }

      expect(publisher.pendingOutbox()).toEqual({ "ob-bound": 2 });
      const recovered = createMockSink();
      await publisher.flushOutbox("ob-bound", recovered);
      const calls = (recovered.publishUpdates as ReturnType<typeof vi.fn>).mock.calls;
      // "a" was evicted as the oldest; the two freshest survived.
      expect(calls.map((c) => (c[0] as VehicleUpdate[])[0].id)).toEqual(["b", "c"]);
    });

    it("discards (loudly) whatever is buffered when the outbox is turned off", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      await publisher.publishUpdates(updates, new Map([["ob-toggle", failing]]));
      expect(publisher.pendingOutbox()).toEqual({ "ob-toggle": 2 });

      publisher.configure({ outbox: { enabled: false } });

      expect(publisher.isOutboxEnabled()).toBe(false);
      expect(publisher.pendingOutbox()).toEqual({});
    });

    it("reports what discardOutbox threw away (the buffer is not restart-durable)", async () => {
      const publisher = new Publisher();
      publisher.configure({ outbox: { enabled: true } });
      const failing = createMockSink({
        publishUpdates: vi.fn().mockRejectedValue(new Error("down")),
      });
      await publisher.publishUpdates(updates, new Map([["ob-discard", failing]]));

      expect(publisher.discardOutbox()).toEqual({ "ob-discard": 2 });
      expect(publisher.pendingOutbox()).toEqual({});
    });
  });

  describe("circuit breaker", () => {
    it("opens after the threshold and stops calling the sink", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 3, cooldownMs: 60_000 } });
      const publishUpdates = vi.fn().mockRejectedValue(new Error("broker down"));
      const sinks = new Map([["cb-hammer", createMockSink({ publishUpdates })]]);

      for (let i = 0; i < 3; i++) await publisher.publishUpdates(updates, sinks);
      expect(publishUpdates).toHaveBeenCalledTimes(3);
      expect(publisher.breakerState("cb-hammer")).toBe("open");

      const result = await publisher.publishUpdates(updates, sinks);

      // Not hammered any more: the 4th publish never reached the sink.
      expect(publishUpdates).toHaveBeenCalledTimes(3);
      expect(result.status).toBe("failure");
      expect(result.sinks[0].error).toContain("circuit breaker open");
    });

    it("is visible in the Prometheus exposition when open", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 2, cooldownMs: 60_000 } });
      const sinks = new Map([
        [
          "cb-visible",
          createMockSink({ publishUpdates: vi.fn().mockRejectedValue(new Error("down")) }),
        ],
      ]);

      for (let i = 0; i < 2; i++) await publisher.publishUpdates(updates, sinks);

      const text = await metrics.registry.metrics();
      expect(text).toContain('adapter_sink_breaker_state{sink="cb-visible"} 2');
      expect(text).toContain(
        'adapter_sink_breaker_transitions_total{sink="cb-visible",state="open"} 1'
      );
    });

    it("counts skipped publishes as drops when the outbox is off", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 1, cooldownMs: 60_000 } });
      const sinks = new Map([
        [
          "cb-drop",
          createMockSink({ publishUpdates: vi.fn().mockRejectedValue(new Error("down")) }),
        ],
      ]);
      await publisher.publishUpdates(updates, sinks);
      const before = await deliveryCount("cb-drop", "drop");

      await publisher.publishUpdates(updates, sinks);

      expect(await deliveryCount("cb-drop", "drop")).toBe(before + updates.length);
    });

    it("buffers skipped publishes instead of dropping them when the outbox is on", async () => {
      const publisher = new Publisher();
      publisher.configure({
        breaker: { failureThreshold: 1, cooldownMs: 60_000 },
        outbox: { enabled: true },
      });
      const sinks = new Map([
        [
          "cb-buffer",
          createMockSink({ publishUpdates: vi.fn().mockRejectedValue(new Error("down")) }),
        ],
      ]);

      await publisher.publishUpdates(updates, sinks); // fails, opens breaker, buffers
      await publisher.publishUpdates(updates, sinks); // skipped, still buffered

      expect(publisher.pendingOutbox()).toEqual({ "cb-buffer": 4 });
    });

    it("does not stop other sinks from being published to", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 1, cooldownMs: 60_000 } });
      const healthy = createMockSink();
      const sinks = new Map([
        [
          "cb-broken",
          createMockSink({ publishUpdates: vi.fn().mockRejectedValue(new Error("down")) }),
        ],
        ["cb-healthy", healthy],
      ]);

      await publisher.publishUpdates(updates, sinks);
      const result = await publisher.publishUpdates(updates, sinks);

      expect(result.status).toBe("partial");
      // Order of the per-sink results still matches the sink map.
      expect(result.sinks.map((s) => s.type)).toEqual(["cb-broken", "cb-healthy"]);
      expect(healthy.publishUpdates).toHaveBeenCalledTimes(2);
    });

    it("resumes immediately when the sink is proved healthy (reconnect sweep path)", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 1, cooldownMs: 60_000 } });
      const publishUpdates = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValue(undefined);
      const sinks = new Map([["cb-resume", createMockSink({ publishUpdates })]]);

      await publisher.publishUpdates(updates, sinks);
      expect(publisher.breakerState("cb-resume")).toBe("open");

      publisher.onSinkHealthy("cb-resume");

      expect(publisher.breakerState("cb-resume")).toBe("closed");
      const result = await publisher.publishUpdates(updates, sinks);
      expect(result.status).toBe("success");
      expect(publishUpdates).toHaveBeenCalledTimes(2);
    });

    it("never opens when disabled, no matter how many failures", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { enabled: false, failureThreshold: 2 } });
      const publishUpdates = vi.fn().mockRejectedValue(new Error("down"));
      const sinks = new Map([["cb-off", createMockSink({ publishUpdates })]]);

      for (let i = 0; i < 6; i++) await publisher.publishUpdates(updates, sinks);

      expect(publisher.breakerState("cb-off")).toBe("closed");
      expect(publishUpdates).toHaveBeenCalledTimes(6);
    });

    it("does not trip on partial failures (the backend is reachable)", async () => {
      const publisher = new Publisher();
      publisher.configure({ breaker: { failureThreshold: 2, cooldownMs: 60_000 } });
      const partial: SinkPublishResult = {
        attempted: 2,
        succeeded: 1,
        failures: [{ itemId: "chunk-1", error: "one chunk failed" }],
      };
      const publishUpdates = vi.fn().mockResolvedValue(partial);
      const sinks = new Map([["cb-partial", createMockSink({ publishUpdates })]]);

      for (let i = 0; i < 5; i++) await publisher.publishUpdates(updates, sinks);

      expect(publisher.breakerState("cb-partial")).toBe("closed");
      expect(publishUpdates).toHaveBeenCalledTimes(5);
    });
  });
});

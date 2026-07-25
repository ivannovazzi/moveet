import { describe, it, expect } from "vitest";
import { DEFAULT_OUTBOX_OPTIONS, SinkOutbox, type OutboxOptions } from "./outbox";
import type { VehicleUpdate } from "../types";
import { metrics } from "../metrics";

function updates(n: number, prefix = "v"): VehicleUpdate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    latitude: -1.28,
    longitude: 36.8,
  }));
}

function options(overrides: Partial<OutboxOptions> = {}): OutboxOptions {
  return { ...DEFAULT_OUTBOX_OPTIONS, enabled: true, ...overrides };
}

/** Current value of an outbox counter cell (0 when absent). */
async function droppedCount(sink: string, reason: string): Promise<number> {
  const json = await metrics.outboxDropped.get();
  return json.values.find((v) => v.labels.sink === sink && v.labels.reason === reason)?.value ?? 0;
}

describe("SinkOutbox", () => {
  it("is disabled in the default options (at-most-once stays the default)", () => {
    expect(DEFAULT_OUTBOX_OPTIONS.enabled).toBe(false);
  });

  it("buffers batches per sink, oldest first", () => {
    const outbox = new SinkOutbox(options());

    outbox.enqueue("a", updates(2));
    outbox.enqueue("a", updates(3));
    outbox.enqueue("b", updates(1));

    expect(outbox.entryCount("a")).toBe(2);
    expect(outbox.pendingUpdates("a")).toBe(5);
    expect(outbox.pendingUpdates("b")).toBe(1);
    expect(outbox.pendingBySink()).toEqual({ a: 5, b: 1 });

    const taken = outbox.take("a");
    expect(taken.map((e) => e.updates.length)).toEqual([2, 3]);
    expect(outbox.pendingUpdates("a")).toBe(0);
  });

  it("ignores an empty batch", () => {
    const outbox = new SinkOutbox(options());
    expect(outbox.enqueue("a", [])).toBe(0);
    expect(outbox.entryCount("a")).toBe(0);
  });

  it("enforces the entry bound with a drop-oldest policy", async () => {
    const outbox = new SinkOutbox(options({ maxEntries: 2 }));
    const before = await droppedCount("bound-entries", "overflow");

    outbox.enqueue("bound-entries", updates(1, "old"));
    outbox.enqueue("bound-entries", updates(1, "mid"));
    outbox.enqueue("bound-entries", updates(1, "new"));

    expect(outbox.entryCount("bound-entries")).toBe(2);
    // The OLDEST batch was evicted; the two newest survive in order.
    const remaining = outbox.take("bound-entries");
    expect(remaining.map((e) => e.updates[0].id)).toEqual(["mid0", "new0"]);
    expect(await droppedCount("bound-entries", "overflow")).toBe(before + 1);
  });

  it("enforces the update bound with a drop-oldest policy", () => {
    const outbox = new SinkOutbox(options({ maxEntries: 100, maxUpdates: 5 }));

    outbox.enqueue("bound-updates", updates(3, "old"));
    outbox.enqueue("bound-updates", updates(3, "new"));

    // 6 > 5, so the oldest batch goes entirely.
    expect(outbox.pendingUpdates("bound-updates")).toBe(3);
    expect(outbox.take("bound-updates")[0].updates[0].id).toBe("new0");
  });

  it("rejects a single batch bigger than the whole bound instead of emptying the queue", async () => {
    const outbox = new SinkOutbox(options({ maxUpdates: 5 }));
    outbox.enqueue("oversized", updates(4, "keep"));
    const before = await droppedCount("oversized", "overflow");

    const buffered = outbox.enqueue("oversized", updates(9, "huge"));

    expect(buffered).toBe(0);
    // The already-buffered batch was NOT sacrificed for a batch that can't fit.
    expect(outbox.pendingUpdates("oversized")).toBe(4);
    expect(await droppedCount("oversized", "overflow")).toBe(before + 9);
  });

  it("counts evicted updates as drops on the delivery counter too", async () => {
    const outbox = new SinkOutbox(options({ maxEntries: 1 }));
    const deliveries = async (): Promise<number> => {
      const json = await metrics.sinkDeliveries.get();
      return (
        json.values.find((v) => v.labels.sink === "evict-drop" && v.labels.outcome === "drop")
          ?.value ?? 0
      );
    };
    const before = await deliveries();

    outbox.enqueue("evict-drop", updates(4));
    outbox.enqueue("evict-drop", updates(1));

    expect(await deliveries()).toBe(before + 4);
  });

  it("requeues un-flushed entries at the head, ahead of newer arrivals", () => {
    const outbox = new SinkOutbox(options());
    const [older] = [{ updates: updates(1, "older"), enqueuedAt: 1, attempts: 1 }];
    outbox.enqueue("requeue", updates(1, "newer"));

    outbox.requeueFront("requeue", [older]);

    expect(outbox.take("requeue").map((e) => e.updates[0].id)).toEqual(["older0", "newer0"]);
  });

  it("publishes the buffered size onto the metrics gauge", async () => {
    const outbox = new SinkOutbox(options());
    outbox.enqueue("gauge-sink", updates(7));

    const json = await metrics.outboxSize.get();
    expect(json.values.find((v) => v.labels.sink === "gauge-sink")?.value).toBe(7);

    outbox.take("gauge-sink");
    const after = await metrics.outboxSize.get();
    expect(after.values.find((v) => v.labels.sink === "gauge-sink")?.value).toBe(0);
  });

  it("clear() discards a queue and counts it under the given reason", async () => {
    const outbox = new SinkOutbox(options());
    outbox.enqueue("cleared", updates(3));
    const before = await droppedCount("cleared", "shutdown");

    expect(outbox.clear("cleared", "shutdown")).toBe(3);

    expect(outbox.pendingUpdates("cleared")).toBe(0);
    expect(await droppedCount("cleared", "shutdown")).toBe(before + 3);
  });

  it("re-applies the bounds when reconfigured to a smaller buffer", () => {
    const outbox = new SinkOutbox(options({ maxEntries: 10 }));
    outbox.enqueue("shrink", updates(1, "a"));
    outbox.enqueue("shrink", updates(1, "b"));
    outbox.enqueue("shrink", updates(1, "c"));

    outbox.reconfigure(options({ maxEntries: 1 }));

    expect(outbox.entryCount("shrink")).toBe(1);
    expect(outbox.take("shrink")[0].updates[0].id).toBe("c0");
  });
});

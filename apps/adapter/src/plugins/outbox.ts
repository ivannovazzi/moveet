import type { VehicleUpdate } from "../types";
import type { PublishContext } from "./types";
import { metrics } from "../metrics";
import { createLogger } from "../utils/logger";

const logger = createLogger("SinkOutbox");

/**
 * Optional, opt-in outbox / DLQ buffer for sink deliveries.
 *
 * ## Durability: IN-MEMORY ONLY
 *
 * This buffer lives in the adapter process heap. It is deliberately **not**
 * persisted to disk or to a broker, so:
 *
 *  - it **survives a sink outage** — a broker that dies and comes back gets its
 *    buffered telemetry redelivered by the sink-reconnect sweep;
 *  - it does **not survive an adapter restart, crash, or `docker compose down`**
 *    — everything still buffered at that moment is gone, silently, with only a
 *    warning log on graceful shutdown.
 *
 * That is a real limitation, not an oversight: the honest at-least-once story
 * here is "at-least-once across a sink outage", not "at-least-once across a
 * process restart". Do not build a durability claim on top of this. If you need
 * restart-durable delivery, the buffer has to move to disk (an append-only
 * journal fsync'd before the publish is acked) or to a local broker; the
 * {@link SinkOutbox} interface is deliberately small enough to swap out.
 *
 * ## Duplicates
 *
 * Redelivery is at-least-*once*, so **duplicates are expected**. A partially
 * failed publish is re-queued *whole* (see `retryPartial`) because sinks report
 * failures at chunk granularity, not per update, so the already-delivered part
 * of that batch is sent again. Consumers must be idempotent — the keyed Kafka
 * stream and the GraphQL `upsertVehicles` mutation both are.
 *
 * ## Bounds and overflow policy
 *
 * An unbounded outbox pointed at a permanently dead sink is a memory leak, so
 * every sink's queue is bounded twice: by entry count (`maxEntries`, one entry
 * = one publish batch) and by buffered update count (`maxUpdates`). On
 * overflow the policy is **drop-oldest**: the head of the queue is evicted
 * until the queue fits again. For position telemetry the newest fix supersedes
 * the older ones, so keeping the freshest data is the right trade — but the
 * evicted updates are genuinely lost and are counted as such
 * (`adapter_outbox_dropped_total{sink,reason="overflow"}` plus a `drop` on
 * `adapter_sink_delivery_total`). A single batch larger than `maxUpdates` can
 * never fit and is rejected outright rather than emptying the queue for nothing.
 *
 * An entry that has failed redelivery `maxAttempts` times is also dropped
 * (`reason="max-attempts"`), so one poison batch cannot block the queue forever.
 */
export interface OutboxOptions {
  /** Off by default. When false the adapter keeps its at-most-once behaviour. */
  enabled: boolean;
  /** Max buffered publish batches per sink before drop-oldest kicks in. */
  maxEntries: number;
  /** Max buffered vehicle updates per sink before drop-oldest kicks in. */
  maxUpdates: number;
  /** Redelivery attempts before an entry is dropped as poison. */
  maxAttempts: number;
  /** Buffer partially-failed publishes too (re-sends the whole batch; duplicates). */
  retryPartial: boolean;
}

export const DEFAULT_OUTBOX_OPTIONS: OutboxOptions = {
  enabled: false,
  maxEntries: 1_000,
  maxUpdates: 50_000,
  maxAttempts: 5,
  retryPartial: true,
};

/** Why buffered updates were discarded without ever being delivered. */
export type OutboxDropReason = "overflow" | "max-attempts" | "shutdown";

/** One buffered publish batch, retried as a unit. */
export interface OutboxEntry {
  updates: VehicleUpdate[];
  context?: PublishContext;
  /** Wall-clock time the batch was first buffered. */
  enqueuedAt: number;
  /** Redelivery attempts made so far. */
  attempts: number;
}

/**
 * Bounded, in-memory, per-sink FIFO buffer of failed publish batches.
 *
 * Storage only — it does not know how to deliver anything. The redelivery loop
 * lives in `Publisher.flushOutbox()`, driven by the manager's sink-reconnect
 * sweep.
 */
export class SinkOutbox {
  private readonly queues = new Map<string, OutboxEntry[]>();

  constructor(private options: OutboxOptions = DEFAULT_OUTBOX_OPTIONS) {}

  reconfigure(options: OutboxOptions): void {
    this.options = options;
    for (const sink of this.queues.keys()) this.enforceBounds(sink);
  }

  /**
   * Buffer a failed batch for `sink`. Returns the number of updates actually
   * buffered (0 when the batch was rejected for being larger than the whole
   * per-sink bound).
   */
  enqueue(sink: string, updates: VehicleUpdate[], context?: PublishContext): number {
    if (updates.length === 0) return 0;

    if (updates.length > this.options.maxUpdates) {
      // Evicting the entire queue still would not make room. Refuse the batch
      // instead of throwing away everything already buffered for nothing.
      this.recordDropped(sink, updates.length, "overflow");
      logger.warn(
        { sink, batch: updates.length, maxUpdates: this.options.maxUpdates },
        "Outbox: batch is larger than the per-sink buffer bound — dropped without buffering"
      );
      return 0;
    }

    const queue = this.queueFor(sink);
    queue.push({ updates, context, enqueuedAt: Date.now(), attempts: 0 });
    this.enforceBounds(sink);
    this.publishSize(sink);
    return updates.length;
  }

  /** Number of buffered batches for a sink. */
  entryCount(sink: string): number {
    return this.queues.get(sink)?.length ?? 0;
  }

  /** Number of buffered vehicle updates for a sink. */
  pendingUpdates(sink: string): number {
    return countUpdates(this.queues.get(sink) ?? []);
  }

  /** Buffered update counts per sink, for logging / shutdown warnings. */
  pendingBySink(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [sink, queue] of this.queues) {
      const pending = countUpdates(queue);
      if (pending > 0) out[sink] = pending;
    }
    return out;
  }

  /** Remove and return everything buffered for a sink (oldest first). */
  take(sink: string): OutboxEntry[] {
    const queue = this.queues.get(sink);
    if (!queue || queue.length === 0) return [];
    this.queues.set(sink, []);
    this.publishSize(sink);
    return queue;
  }

  /**
   * Put entries back at the head of the queue after a failed/aborted flush,
   * preserving FIFO order against anything enqueued while the flush ran.
   */
  requeueFront(sink: string, entries: OutboxEntry[]): void {
    if (entries.length === 0) return;
    const queue = this.queueFor(sink);
    queue.unshift(...entries);
    this.enforceBounds(sink);
    this.publishSize(sink);
  }

  /** Discard everything buffered for a sink, counting it as dropped. */
  clear(sink: string, reason: OutboxDropReason): number {
    const queue = this.queues.get(sink);
    if (!queue || queue.length === 0) return 0;
    const lost = countUpdates(queue);
    this.queues.set(sink, []);
    this.recordDropped(sink, lost, reason);
    this.publishSize(sink);
    return lost;
  }

  /** Drop-oldest until the queue satisfies both bounds. */
  private enforceBounds(sink: string): void {
    const queue = this.queueFor(sink);
    let evicted = 0;
    while (
      queue.length > 0 &&
      (queue.length > this.options.maxEntries ||
        countUpdates(queue) > this.options.maxUpdates ||
        // Never leave a lone oversized entry wedged in the queue.
        (queue.length === 1 && queue[0].updates.length > this.options.maxUpdates))
    ) {
      const oldest = queue.shift();
      if (!oldest) break;
      evicted += oldest.updates.length;
    }
    if (evicted > 0) {
      this.recordDropped(sink, evicted, "overflow");
      logger.warn(
        {
          sink,
          droppedUpdates: evicted,
          maxEntries: this.options.maxEntries,
          maxUpdates: this.options.maxUpdates,
        },
        "Outbox full — evicted the oldest buffered updates (drop-oldest policy; those updates are lost)"
      );
    }
  }

  private queueFor(sink: string): OutboxEntry[] {
    let queue = this.queues.get(sink);
    if (!queue) {
      queue = [];
      this.queues.set(sink, queue);
    }
    return queue;
  }

  private publishSize(sink: string): void {
    metrics.setOutboxSize(sink, this.pendingUpdates(sink));
  }

  private recordDropped(sink: string, count: number, reason: OutboxDropReason): void {
    metrics.recordOutboxDropped(sink, reason, count);
    // Those updates were attempted and will never be delivered: that is exactly
    // what the existing at-most-once `drop` outcome means.
    metrics.recordDelivery(sink, "drop", count);
  }
}

function countUpdates(entries: OutboxEntry[]): number {
  let total = 0;
  for (const entry of entries) total += entry.updates.length;
  return total;
}

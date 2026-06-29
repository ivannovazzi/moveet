import type { SinkItemFailure } from "../types";

/**
 * Sink-generic chunking + parallel fan-out helpers.
 *
 * Extracted from the redpanda sink. These helpers know nothing about Kafka or
 * AVRO: a chunk is just a lazily-materialised list of opaque messages and `send`
 * is an opaque "deliver this list" callback. The redpanda sink supplies the
 * Kafka-specific producer.send; another sink could supply its own transport.
 */

/** Split an array into fixed-size chunks. A non-positive size yields one chunk. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length > 0 ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * A planned publish: a total message count plus a list of lazily-materialised
 * chunk producers. Each producer yields its messages only when invoked, so a
 * sink whose serialisation/encoding is expensive (e.g. registry-encoded AVRO)
 * materialises one chunk at a time rather than the whole batch up front.
 */
export interface ChunkPlan<TMessage> {
  total: number;
  chunks: Array<() => Promise<TMessage[]>>;
}

/** Outcome of a chunked, parallel send. Feeds the sink's partial-failure result. */
export interface ChunkSendResult {
  /** Total messages across all chunks (whether or not delivered). */
  attempted: number;
  /** Messages in chunks that were delivered successfully. */
  succeeded: number;
  /** Per-chunk failures (keyed `chunk-<index>`). Empty when all chunks delivered. */
  failures: SinkItemFailure[];
}

/** Hooks invoked per chunk so the caller can record metrics / log without
 *  reaching back into this generic helper. */
export interface ChunkSendHooks {
  onChunkSuccess?: (count: number) => void;
  onChunkFailure?: (count: number, error: string) => void;
}

/**
 * Send every chunk concurrently with `Promise.allSettled` and report per-chunk
 * success/failure accounting.
 *
 * Parallel (rather than sequential abort-on-first-failure) is safe here because
 * the message stream is keyed per-entity (e.g. per-vehicle/per-device): Kafka
 * preserves order within a key, and chunking splits across keys, so two chunks
 * never carry the same key. Reordering across keys is not meaningful, so there
 * is no ordering constraint to preserve between chunks. Parallelising lifts
 * throughput from O(sum of chunk latencies) to O(max chunk latency) and, unlike
 * the old abort-on-failure path, a transient failure in one chunk no longer
 * discards every later chunk's data.
 *
 * Each chunk is materialised (its producer invoked) only inside its own task,
 * so an encode-then-send sink still only holds one chunk's encoded payloads per
 * in-flight task.
 */
export async function sendChunksParallel<TMessage>(
  plan: ChunkPlan<TMessage>,
  send: (messages: TMessage[]) => Promise<void>,
  hooks: ChunkSendHooks = {}
): Promise<ChunkSendResult> {
  const { total, chunks } = plan;

  const settled = await Promise.allSettled(
    chunks.map(async (produce, index) => {
      const messages = await produce();
      await send(messages);
      return { index, count: messages.length };
    })
  );

  let succeeded = 0;
  const failures: SinkItemFailure[] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      succeeded += outcome.value.count;
      hooks.onChunkSuccess?.(outcome.value.count);
    } else {
      const error =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      failures.push({ itemId: `chunk-${index}`, error });
      hooks.onChunkFailure?.(0, error);
    }
  });

  return { attempted: total, succeeded, failures };
}

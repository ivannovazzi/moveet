import type { VehicleUpdate } from "../types";
import type { DataSink, PublishContext, PublishResult, SinkResult } from "./types";
import { createLogger } from "../utils/logger";
import { metrics } from "../metrics";
import {
  CircuitBreaker,
  DEFAULT_BREAKER_OPTIONS,
  type CircuitBreakerOptions,
} from "./circuit-breaker";
import { DEFAULT_OUTBOX_OPTIONS, SinkOutbox, type OutboxEntry, type OutboxOptions } from "./outbox";

const logger = createLogger("Publisher");

/** Opt-in delivery hardening: the outbox/DLQ buffer and the per-sink breaker. */
export interface DeliveryOptions {
  outbox?: Partial<OutboxOptions>;
  breaker?: Partial<CircuitBreakerOptions>;
}

/** What one outbox flush achieved, in vehicle updates. */
export interface FlushResult {
  redelivered: number;
  requeued: number;
  dropped: number;
}

const EMPTY_FLUSH: FlushResult = { redelivered: 0, requeued: 0, dropped: 0 };

/**
 * Publisher — coordinates publishing vehicle updates across active sinks.
 *
 * Fan-out is concurrent (Promise.allSettled) and errors in individual sinks
 * are caught so they never prevent other sinks from receiving updates.
 *
 * Sinks may return partial-success metadata (attempted/succeeded/failures)
 * which is forwarded to the caller via each SinkResult.
 *
 * Each settled result is mirrored onto the `adapter_sink_delivery_total`
 * counter: a clean publish counts as `success`, item/chunk-level partial
 * failures count as `drop` (attempted-but-undelivered, the sink's at-most-once
 * semantics), and a whole-sink throw counts as `failure`. This surfaces the
 * drop/failure counts that previously lived only in the 200/202 response body.
 *
 * ## Delivery hardening (both configured via {@link configure})
 *
 * - **Circuit breaker (on by default).** Each sink gets a {@link CircuitBreaker}.
 *   After N consecutive whole-sink failures its breaker opens and publishes to
 *   that sink are skipped rather than paying the sink's timeout budget on every
 *   `POST /sync`; the state is exported on `adapter_sink_breaker_state{sink}`.
 *   Only whole-sink throws move the breaker — a partial delivery proves the
 *   backend is reachable. Breakers are closed either by a half-open trial after
 *   the cooldown or, sooner, by the manager's sink-reconnect sweep.
 * - **Outbox / DLQ (OFF by default).** When disabled — the default — nothing
 *   about the publish path changes and delivery stays at-most-once: a failed
 *   publish is reported and dropped. When enabled, the failed batch is buffered
 *   in a bounded in-memory {@link SinkOutbox} and redelivered by the
 *   sink-reconnect sweep once the sink is healthy again. See `outbox.ts` for
 *   the durability limits (a process restart loses the buffer), the bounds and
 *   the drop-oldest overflow policy.
 */
export class Publisher {
  private breakerOptions: CircuitBreakerOptions = { ...DEFAULT_BREAKER_OPTIONS };
  private outboxOptions: OutboxOptions = { ...DEFAULT_OUTBOX_OPTIONS };
  /** null when the outbox is disabled (the default at-most-once path). */
  private outbox: SinkOutbox | null = null;
  private readonly breakers = new Map<string, CircuitBreaker>();

  /** Apply delivery options (from startup config). Safe to call more than once. */
  configure(options: DeliveryOptions = {}): void {
    this.breakerOptions = { ...this.breakerOptions, ...options.breaker };
    this.outboxOptions = { ...this.outboxOptions, ...options.outbox };

    for (const breaker of this.breakers.values()) breaker.reconfigure(this.breakerOptions);

    if (!this.outboxOptions.enabled) {
      // Disabling drops whatever was buffered — say so rather than leaking it.
      if (this.outbox) {
        for (const [sink, pending] of Object.entries(this.outbox.pendingBySink())) {
          logger.warn({ sink, pending }, "Outbox disabled — discarding buffered updates");
          this.outbox.clear(sink, "shutdown");
        }
      }
      this.outbox = null;
      return;
    }
    if (this.outbox) this.outbox.reconfigure(this.outboxOptions);
    else this.outbox = new SinkOutbox(this.outboxOptions);
  }

  /** True when the opt-in outbox is active. */
  isOutboxEnabled(): boolean {
    return this.outbox !== null;
  }

  /** Buffered update counts per sink (empty when the outbox is off or drained). */
  pendingOutbox(): Record<string, number> {
    return this.outbox?.pendingBySink() ?? {};
  }

  /** Current breaker state for a sink, or "closed" when it has never published. */
  breakerState(type: string): string {
    return this.breakers.get(type)?.getState() ?? "closed";
  }

  async publishUpdates(
    updates: VehicleUpdate[],
    activeSinks: Map<string, DataSink>,
    context?: PublishContext
  ): Promise<PublishResult> {
    const sinkEntries = Array.from(activeSinks.entries());
    const sinkResults: SinkResult[] = new Array(sinkEntries.length);

    // Ask each breaker first. An open breaker short-circuits the sink: no
    // backend call, no timeout budget spent, and (with the outbox on) the
    // batch is buffered instead of vanishing.
    const attempts: Array<{ index: number; type: string; sink: DataSink }> = [];
    sinkEntries.forEach(([type, sink], index) => {
      if (this.breakerFor(type).allowRequest()) {
        attempts.push({ index, type, sink });
        return;
      }
      sinkResults[index] = this.skippedByBreaker(type, updates, context);
    });

    const settled = await Promise.allSettled(
      attempts.map(async ({ type, sink }) => {
        // Only pass the context arg when present so existing call-site
        // expectations (sink.publishUpdates(updates)) stay exact.
        const result = context
          ? await sink.publishUpdates(updates, context)
          : await sink.publishUpdates(updates);
        const sinkResult: SinkResult = { type, success: true };

        // If the sink returned partial-failure metadata, incorporate it
        if (result && result.failures && result.failures.length > 0) {
          sinkResult.success = false;
          sinkResult.error = `${result.failures.length} of ${result.attempted} items failed`;
          sinkResult.failures = result.failures;
          sinkResult.attempted = result.attempted;
          sinkResult.succeeded = result.succeeded;
        } else if (result) {
          sinkResult.attempted = result.attempted;
          sinkResult.succeeded = result.succeeded;
        }

        return sinkResult;
      })
    );

    settled.forEach((outcome, i) => {
      const { index, type } = attempts[i];
      const breaker = this.breakerFor(type);

      if (outcome.status === "fulfilled") {
        const result = outcome.value;
        this.recordSinkMetrics(type, result);
        if (result.success) {
          breaker.recordSuccess();
        } else {
          // Partial delivery: the backend answered, so this is not breaker
          // evidence — but the undelivered part is still lost unless buffered.
          breaker.recordPartial();
          this.buffer(type, updates, context, result, this.outboxOptions.retryPartial);
        }
        sinkResults[index] = result;
        return;
      }

      const err = outcome.reason;
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, sink: type }, `Sink ${type} error`);
      // A whole-sink throw: the entire publish to this sink failed.
      metrics.recordDelivery(type, "failure");
      breaker.recordFailure(error);
      const failed: SinkResult = { type, success: false, error };
      this.buffer(type, updates, context, failed, true);
      sinkResults[index] = failed;
    });

    const failCount = sinkResults.filter((r) => !r.success).length;
    let status: PublishResult["status"];
    if (failCount === 0) {
      status = "success";
    } else if (failCount < sinkResults.length) {
      status = "partial";
    } else {
      status = "failure";
    }

    return { status, sinks: sinkResults };
  }

  /**
   * The sink's backend is reachable again (proved by the manager's health probe
   * or a successful reconnect): close its breaker so publishes resume
   * immediately rather than waiting for the half-open cooldown.
   */
  onSinkHealthy(type: string, reason = "sink health probe succeeded"): void {
    const breaker = this.breakers.get(type);
    if (breaker) breaker.close(reason);
  }

  /**
   * Redeliver everything buffered for a sink, oldest batch first.
   *
   * Driven by `PluginManager.reconnectUnhealthySinks()` (the existing sweep),
   * so redelivery latency is bounded by that loop's interval rather than by a
   * second timer of its own.
   *
   * Sequential and abort-on-first-failure *within the flush*: if the sink is
   * still broken there is no point marching through the rest of the queue, and
   * stopping keeps the buffered batches in their original order. Whatever is
   * left is put back at the head of the queue for the next sweep. An entry that
   * has burned `maxAttempts` redeliveries is dropped as poison so it cannot
   * wedge the queue.
   */
  async flushOutbox(type: string, sink: DataSink): Promise<FlushResult> {
    if (!this.outbox) return EMPTY_FLUSH;
    const entries = this.outbox.take(type);
    if (entries.length === 0) return EMPTY_FLUSH;

    let redelivered = 0;
    let dropped = 0;
    const remaining: OutboxEntry[] = [];
    let aborted = false;

    for (const entry of entries) {
      if (aborted) {
        remaining.push(entry);
        continue;
      }
      entry.attempts += 1;
      try {
        const result = entry.context
          ? await sink.publishUpdates(entry.updates, entry.context)
          : await sink.publishUpdates(entry.updates);
        if (result?.failures && result.failures.length > 0) {
          throw new Error(`${result.failures.length} of ${result.attempted} items failed`);
        }
        redelivered += entry.updates.length;
        metrics.recordOutboxRedelivered(type, entry.updates.length);
        metrics.recordDelivery(type, "success", entry.updates.length);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (entry.attempts >= this.outboxOptions.maxAttempts) {
          dropped += entry.updates.length;
          metrics.recordOutboxDropped(type, "max-attempts", entry.updates.length);
          metrics.recordDelivery(type, "drop", entry.updates.length);
          logger.error(
            { sink: type, updates: entry.updates.length, attempts: entry.attempts, err: error },
            "Outbox: giving up on a buffered batch after maxAttempts — updates are lost"
          );
          continue;
        }
        remaining.push(entry);
        aborted = true;
        logger.warn(
          { sink: type, attempts: entry.attempts, err: error },
          "Outbox: redelivery failed — keeping the batch buffered for the next sweep"
        );
      }
    }

    this.outbox.requeueFront(type, remaining);
    const requeued = remaining.reduce((n, e) => n + e.updates.length, 0);
    if (redelivered > 0) {
      logger.info(
        { sink: type, redelivered, requeued, dropped },
        "Outbox: redelivered buffered updates"
      );
    }
    return { redelivered, requeued, dropped };
  }

  /** Discard every buffered batch (called on shutdown — the buffer is not durable). */
  discardOutbox(): Record<string, number> {
    if (!this.outbox) return {};
    const pending = this.outbox.pendingBySink();
    for (const sink of Object.keys(pending)) this.outbox.clear(sink, "shutdown");
    return pending;
  }

  private breakerFor(type: string): CircuitBreaker {
    let breaker = this.breakers.get(type);
    if (!breaker) {
      breaker = new CircuitBreaker(type, this.breakerOptions);
      this.breakers.set(type, breaker);
    }
    return breaker;
  }

  /** Result for a sink whose breaker is open: not attempted, buffered or dropped. */
  private skippedByBreaker(
    type: string,
    updates: VehicleUpdate[],
    context: PublishContext | undefined
  ): SinkResult {
    const result: SinkResult = {
      type,
      success: false,
      error: `circuit breaker open for sink "${type}" — publish skipped`,
    };
    if (this.outbox) {
      this.buffer(type, updates, context, result, true);
    } else {
      // At-most-once: nothing was attempted and nothing is retained.
      metrics.recordDelivery(type, "drop", updates.length);
    }
    return result;
  }

  /**
   * Buffer a failed/partial batch when the outbox is enabled. No-op (and no
   * change to the SinkResult) when it is disabled, which is what keeps the
   * default at-most-once path byte-for-byte unchanged.
   */
  private buffer(
    type: string,
    updates: VehicleUpdate[],
    context: PublishContext | undefined,
    result: SinkResult,
    shouldBuffer: boolean
  ): void {
    if (!this.outbox || !shouldBuffer) return;
    const buffered = this.outbox.enqueue(type, updates, context);
    if (buffered > 0) result.buffered = buffered;
  }

  /**
   * Mirror a fulfilled sink result onto the delivery counter. When the sink
   * reported partial-failure metadata, the succeeded count is `success` and the
   * (attempted − succeeded) shortfall is `drop`; otherwise a clean publish
   * counts as a single `success`.
   */
  private recordSinkMetrics(sinkType: string, result: SinkResult): void {
    if (result.attempted != null && result.succeeded != null) {
      metrics.recordDelivery(sinkType, "success", result.succeeded);
      const dropped = result.attempted - result.succeeded;
      if (dropped > 0) metrics.recordDelivery(sinkType, "drop", dropped);
      return;
    }
    // Sink returned void / no metadata: count the publish as one success.
    metrics.recordDelivery(sinkType, "success");
  }
}

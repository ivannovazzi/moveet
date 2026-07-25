import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";
import type { Request, Response } from "express";

/**
 * Prometheus metrics for the adapter.
 *
 * A dedicated {@link Registry} (rather than the global default) keeps the metric
 * set scoped to this process and lets tests instantiate isolated registries.
 * Default Node/process metrics (event-loop lag, GC, heap, etc.) are collected
 * alongside the custom collectors below.
 *
 * Custom collectors:
 *  - `adapter_sink_delivery_total{sink,outcome}` — counts per-sink delivery
 *    outcomes (`success` / `drop` / `failure`). `drop` is a per-item/per-chunk
 *    delivery that was attempted and definitively not delivered (the default
 *    at-most-once semantics, or an outbox eviction); `failure` is a whole-sink
 *    publish error.
 *  - `adapter_publish_duration_seconds{path,outcome}` — latency histogram for a
 *    publish operation (e.g. the `POST /sync` handler).
 *  - `adapter_sink_breaker_state{sink}` — per-sink circuit-breaker state as a
 *    gauge (0 = closed, 1 = half-open, 2 = open), so a sink that has been cut
 *    off after repeated failures is visible instead of silently dropping.
 *  - `adapter_sink_breaker_transitions_total{sink,state}` — breaker transitions,
 *    for alerting on flapping.
 *  - `adapter_outbox_size{sink}` — vehicle updates currently buffered in the
 *    (opt-in, in-memory) outbox awaiting redelivery.
 *  - `adapter_outbox_redelivered_total{sink}` — updates successfully redelivered
 *    from the outbox.
 *  - `adapter_outbox_dropped_total{sink,reason}` — buffered updates discarded
 *    without delivery (`overflow` / `max-attempts` / `shutdown`). These are also
 *    counted as `drop` on `adapter_sink_delivery_total`.
 */

export type SinkDeliveryOutcome = "success" | "drop" | "failure";

/** Numeric encoding of the breaker state for the gauge (Prometheus has no enums). */
const BREAKER_STATE_VALUE: Record<string, number> = {
  closed: 0,
  "half-open": 1,
  open: 2,
};

export class AdapterMetrics {
  readonly registry: Registry;

  /** Per-sink delivery outcome counter (success / drop / failure). */
  readonly sinkDeliveries: Counter<"sink" | "outcome">;

  /** Latency of a publish operation (e.g. POST /sync handling). */
  readonly publishDuration: Histogram<"path" | "outcome">;

  /** Per-sink circuit-breaker state (0 closed / 1 half-open / 2 open). */
  readonly sinkBreakerState: Gauge<"sink">;

  /** Per-sink circuit-breaker transitions, labelled by the state entered. */
  readonly sinkBreakerTransitions: Counter<"sink" | "state">;

  /** Vehicle updates currently buffered in the outbox, per sink. */
  readonly outboxSize: Gauge<"sink">;

  /** Vehicle updates successfully redelivered from the outbox, per sink. */
  readonly outboxRedelivered: Counter<"sink">;

  /** Buffered updates discarded without delivery, per sink and reason. */
  readonly outboxDropped: Counter<"sink" | "reason">;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.sinkDeliveries = new Counter({
      name: "adapter_sink_delivery_total",
      help: "Total sink delivery outcomes, labelled by sink name and outcome (success/drop/failure).",
      labelNames: ["sink", "outcome"] as const,
      registers: [this.registry],
    });

    this.publishDuration = new Histogram({
      name: "adapter_publish_duration_seconds",
      help: "Duration of a publish operation in seconds, labelled by request path and outcome.",
      labelNames: ["path", "outcome"] as const,
      // Position syncs are sub-second in the happy path but can stretch when a
      // broker is slow; cover ms..multi-second.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.sinkBreakerState = new Gauge({
      name: "adapter_sink_breaker_state",
      help: "Circuit-breaker state per sink: 0 = closed, 1 = half-open, 2 = open.",
      labelNames: ["sink"] as const,
      registers: [this.registry],
    });

    this.sinkBreakerTransitions = new Counter({
      name: "adapter_sink_breaker_transitions_total",
      help: "Circuit-breaker state transitions per sink, labelled by the state entered.",
      labelNames: ["sink", "state"] as const,
      registers: [this.registry],
    });

    this.outboxSize = new Gauge({
      name: "adapter_outbox_size",
      help: "Vehicle updates currently buffered in the outbox awaiting redelivery, per sink.",
      labelNames: ["sink"] as const,
      registers: [this.registry],
    });

    this.outboxRedelivered = new Counter({
      name: "adapter_outbox_redelivered_total",
      help: "Vehicle updates successfully redelivered from the outbox, per sink.",
      labelNames: ["sink"] as const,
      registers: [this.registry],
    });

    this.outboxDropped = new Counter({
      name: "adapter_outbox_dropped_total",
      help: "Buffered updates discarded without delivery, per sink and reason (overflow/max-attempts/shutdown).",
      labelNames: ["sink", "reason"] as const,
      registers: [this.registry],
    });
  }

  /** Record a delivery outcome for a sink, optionally incrementing by `count`. */
  recordDelivery(sink: string, outcome: SinkDeliveryOutcome, count = 1): void {
    if (count <= 0) return;
    this.sinkDeliveries.inc({ sink, outcome }, count);
  }

  /** Publish the current circuit-breaker state for a sink onto the gauge. */
  setBreakerState(sink: string, state: string): void {
    this.sinkBreakerState.set({ sink }, BREAKER_STATE_VALUE[state] ?? 0);
  }

  /** Count a circuit-breaker transition into `state` for a sink. */
  recordBreakerTransition(sink: string, state: string): void {
    this.sinkBreakerTransitions.inc({ sink, state });
  }

  /** Publish the number of updates currently buffered for a sink. */
  setOutboxSize(sink: string, updates: number): void {
    this.outboxSize.set({ sink }, updates);
  }

  /** Count updates successfully redelivered from the outbox. */
  recordOutboxRedelivered(sink: string, count = 1): void {
    if (count <= 0) return;
    this.outboxRedelivered.inc({ sink }, count);
  }

  /** Count buffered updates discarded without ever being delivered. */
  recordOutboxDropped(sink: string, reason: string, count = 1): void {
    if (count <= 0) return;
    this.outboxDropped.inc({ sink, reason }, count);
  }

  /**
   * Express handler for `GET /metrics`. Returns the registry exposition in the
   * Prometheus text format with the correct content-type.
   */
  metricsHandler = async (_req: Request, res: Response): Promise<void> => {
    res.set("Content-Type", this.registry.contentType);
    res.send(await this.registry.metrics());
  };
}

/** Process-wide metrics instance, shared by the server and its collaborators. */
export const metrics = new AdapterMetrics();

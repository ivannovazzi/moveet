import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";
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
 *    delivery that was attempted-but-not-delivered (the at-most-once,
 *    no-DLQ semantics); `failure` is a whole-sink publish error.
 *  - `adapter_publish_duration_seconds{path,outcome}` — latency histogram for a
 *    publish operation (e.g. the `POST /sync` handler).
 */

export type SinkDeliveryOutcome = "success" | "drop" | "failure";

export class AdapterMetrics {
  readonly registry: Registry;

  /** Per-sink delivery outcome counter (success / drop / failure). */
  readonly sinkDeliveries: Counter<"sink" | "outcome">;

  /** Latency of a publish operation (e.g. POST /sync handling). */
  readonly publishDuration: Histogram<"path" | "outcome">;

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
  }

  /** Record a delivery outcome for a sink, optionally incrementing by `count`. */
  recordDelivery(sink: string, outcome: SinkDeliveryOutcome, count = 1): void {
    if (count <= 0) return;
    this.sinkDeliveries.inc({ sink, outcome }, count);
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

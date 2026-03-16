/**
 * Lightweight in-memory metrics collector with histogram, counter, and gauge support.
 *
 * Provides p50/p95/p99 percentile calculations for histograms and exposes
 * metrics in both JSON and Prometheus text formats via GET /metrics.
 *
 * Design:
 * - Singleton instance for global access across modules
 * - Histograms use a circular buffer to bound memory usage
 * - All operations are synchronous and non-blocking
 */

/** Maximum number of observations stored per histogram. */
const DEFAULT_MAX_OBSERVATIONS = 1000;

interface HistogramData {
  values: number[];
  /** Pointer for circular buffer insertion. */
  pointer: number;
  count: number;
  sum: number;
  maxObservations: number;
}

interface CounterData {
  value: number;
}

interface GaugeData {
  value: number;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  histograms: Record<string, HistogramSnapshot>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timestamp: string;
}

export class MetricsCollector {
  private histograms: Map<string, HistogramData> = new Map();
  private counters: Map<string, CounterData> = new Map();
  private gauges: Map<string, GaugeData> = new Map();

  private static _instance: MetricsCollector | null = null;

  /**
   * Returns the global singleton instance.
   */
  static getInstance(): MetricsCollector {
    if (!MetricsCollector._instance) {
      MetricsCollector._instance = new MetricsCollector();
    }
    return MetricsCollector._instance;
  }

  /**
   * Resets the singleton (useful for tests).
   */
  static resetInstance(): void {
    MetricsCollector._instance = null;
  }

  // ─── Histogram ──────────────────────────────────────────────────────

  /**
   * Records a value in a histogram. Creates the histogram if it does not exist.
   */
  observeHistogram(name: string, value: number, maxObservations = DEFAULT_MAX_OBSERVATIONS): void {
    let hist = this.histograms.get(name);
    if (!hist) {
      hist = { values: [], pointer: 0, count: 0, sum: 0, maxObservations };
      this.histograms.set(name, hist);
    }

    if (hist.values.length < hist.maxObservations) {
      hist.values.push(value);
    } else {
      hist.values[hist.pointer] = value;
    }
    hist.pointer = (hist.pointer + 1) % hist.maxObservations;
    hist.count++;
    hist.sum += value;
  }

  /**
   * Returns a snapshot of a histogram including percentiles.
   * Returns null if the histogram does not exist or has no observations.
   */
  getHistogram(name: string): HistogramSnapshot | null {
    const hist = this.histograms.get(name);
    if (!hist || hist.values.length === 0) return null;

    const sorted = [...hist.values].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      count: hist.count,
      sum: hist.sum,
      avg: hist.sum / hist.count,
      min: sorted[0],
      max: sorted[len - 1],
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }

  // ─── Counter ────────────────────────────────────────────────────────

  /**
   * Increments a counter by the given amount (default 1).
   */
  incrementCounter(name: string, amount = 1): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.value += amount;
    } else {
      this.counters.set(name, { value: amount });
    }
  }

  /**
   * Returns the current value of a counter, or 0 if it does not exist.
   */
  getCounter(name: string): number {
    return this.counters.get(name)?.value ?? 0;
  }

  // ─── Gauge ──────────────────────────────────────────────────────────

  /**
   * Sets a gauge to a specific value.
   */
  setGauge(name: string, value: number): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value = value;
    } else {
      this.gauges.set(name, { value });
    }
  }

  /**
   * Returns the current value of a gauge, or 0 if it does not exist.
   */
  getGauge(name: string): number {
    return this.gauges.get(name)?.value ?? 0;
  }

  // ─── Output ─────────────────────────────────────────────────────────

  /**
   * Returns a full snapshot of all metrics as a plain object.
   */
  toJSON(): MetricsSnapshot {
    const histograms: Record<string, HistogramSnapshot> = {};
    for (const [name, _data] of this.histograms) {
      void _data;
      const snap = this.getHistogram(name);
      if (snap) histograms[name] = snap;
    }

    const counters: Record<string, number> = {};
    for (const [name, data] of this.counters) {
      counters[name] = data.value;
    }

    const gauges: Record<string, number> = {};
    for (const [name, data] of this.gauges) {
      gauges[name] = data.value;
    }

    return {
      histograms,
      counters,
      gauges,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Returns metrics in Prometheus text exposition format.
   */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const [name] of this.histograms) {
      const snap = this.getHistogram(name);
      if (!snap) continue;
      const safeName = prometheusName(name);
      lines.push(`# HELP ${safeName} Histogram of ${name}`);
      lines.push(`# TYPE ${safeName} summary`);
      lines.push(`${safeName}{quantile="0.5"} ${snap.p50}`);
      lines.push(`${safeName}{quantile="0.95"} ${snap.p95}`);
      lines.push(`${safeName}{quantile="0.99"} ${snap.p99}`);
      lines.push(`${safeName}_sum ${snap.sum}`);
      lines.push(`${safeName}_count ${snap.count}`);
      lines.push(`${safeName}_avg ${snap.avg}`);
      lines.push(`${safeName}_min ${snap.min}`);
      lines.push(`${safeName}_max ${snap.max}`);
    }

    for (const [name, data] of this.counters) {
      const safeName = prometheusName(name);
      lines.push(`# HELP ${safeName} Counter for ${name}`);
      lines.push(`# TYPE ${safeName} counter`);
      lines.push(`${safeName} ${data.value}`);
    }

    for (const [name, data] of this.gauges) {
      const safeName = prometheusName(name);
      lines.push(`# HELP ${safeName} Gauge for ${name}`);
      lines.push(`# TYPE ${safeName} gauge`);
      lines.push(`${safeName} ${data.value}`);
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Resets all metrics. Useful for testing.
   */
  reset(): void {
    this.histograms.clear();
    this.counters.clear();
    this.gauges.clear();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Computes a percentile from a pre-sorted array using linear interpolation.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/**
 * Converts a metric name to a Prometheus-safe name (replace dots/dashes with underscores).
 */
function prometheusName(name: string): string {
  return name.replace(/[.\-]/g, "_");
}

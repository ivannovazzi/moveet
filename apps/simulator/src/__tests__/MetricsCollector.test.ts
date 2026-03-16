import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "../modules/MetricsCollector";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    MetricsCollector.resetInstance();
    metrics = new MetricsCollector();
  });

  // ─── Histogram ──────────────────────────────────────────────────────

  describe("histogram", () => {
    it("should return null for a non-existent histogram", () => {
      expect(metrics.getHistogram("nonexistent")).toBeNull();
    });

    it("should record a single observation", () => {
      metrics.observeHistogram("latency", 42);
      const snap = metrics.getHistogram("latency");
      expect(snap).not.toBeNull();
      expect(snap!.count).toBe(1);
      expect(snap!.sum).toBe(42);
      expect(snap!.avg).toBe(42);
      expect(snap!.min).toBe(42);
      expect(snap!.max).toBe(42);
      expect(snap!.p50).toBe(42);
      expect(snap!.p95).toBe(42);
      expect(snap!.p99).toBe(42);
    });

    it("should compute correct percentiles for multiple observations", () => {
      // Record values 1 through 100
      for (let i = 1; i <= 100; i++) {
        metrics.observeHistogram("latency", i);
      }

      const snap = metrics.getHistogram("latency")!;
      expect(snap.count).toBe(100);
      expect(snap.sum).toBe(5050);
      expect(snap.avg).toBeCloseTo(50.5);
      expect(snap.min).toBe(1);
      expect(snap.max).toBe(100);
      expect(snap.p50).toBeCloseTo(50.5, 0);
      expect(snap.p95).toBeCloseTo(95.05, 0);
      expect(snap.p99).toBeCloseTo(99.01, 0);
    });

    it("should handle two observations correctly", () => {
      metrics.observeHistogram("latency", 10);
      metrics.observeHistogram("latency", 20);

      const snap = metrics.getHistogram("latency")!;
      expect(snap.count).toBe(2);
      expect(snap.min).toBe(10);
      expect(snap.max).toBe(20);
      expect(snap.p50).toBe(15);
    });

    it("should use circular buffer when exceeding maxObservations", () => {
      const maxObs = 5;
      // Record 10 values with a buffer of 5
      for (let i = 1; i <= 10; i++) {
        metrics.observeHistogram("latency", i, maxObs);
      }

      const snap = metrics.getHistogram("latency")!;
      // count tracks all observations ever made
      expect(snap.count).toBe(10);
      // sum tracks all observations ever made
      expect(snap.sum).toBe(55);
      // But min/max/percentiles are based on the buffer (last 5 values: 6,7,8,9,10)
      expect(snap.min).toBe(6);
      expect(snap.max).toBe(10);
    });

    it("should support multiple independent histograms", () => {
      metrics.observeHistogram("pathfinding", 100);
      metrics.observeHistogram("broadcast", 5);

      expect(metrics.getHistogram("pathfinding")!.sum).toBe(100);
      expect(metrics.getHistogram("broadcast")!.sum).toBe(5);
    });

    it("should handle observations of zero", () => {
      metrics.observeHistogram("latency", 0);
      const snap = metrics.getHistogram("latency")!;
      expect(snap.min).toBe(0);
      expect(snap.max).toBe(0);
      expect(snap.avg).toBe(0);
    });

    it("should handle negative observations", () => {
      metrics.observeHistogram("delta", -5);
      metrics.observeHistogram("delta", 5);
      const snap = metrics.getHistogram("delta")!;
      expect(snap.min).toBe(-5);
      expect(snap.max).toBe(5);
      expect(snap.avg).toBe(0);
    });
  });

  // ─── Counter ────────────────────────────────────────────────────────

  describe("counter", () => {
    it("should return 0 for a non-existent counter", () => {
      expect(metrics.getCounter("nonexistent")).toBe(0);
    });

    it("should increment by 1 by default", () => {
      metrics.incrementCounter("requests");
      expect(metrics.getCounter("requests")).toBe(1);
    });

    it("should increment by a custom amount", () => {
      metrics.incrementCounter("bytes", 1024);
      expect(metrics.getCounter("bytes")).toBe(1024);
    });

    it("should accumulate multiple increments", () => {
      metrics.incrementCounter("requests");
      metrics.incrementCounter("requests");
      metrics.incrementCounter("requests", 3);
      expect(metrics.getCounter("requests")).toBe(5);
    });

    it("should support multiple independent counters", () => {
      metrics.incrementCounter("a", 10);
      metrics.incrementCounter("b", 20);
      expect(metrics.getCounter("a")).toBe(10);
      expect(metrics.getCounter("b")).toBe(20);
    });
  });

  // ─── Gauge ──────────────────────────────────────────────────────────

  describe("gauge", () => {
    it("should return 0 for a non-existent gauge", () => {
      expect(metrics.getGauge("nonexistent")).toBe(0);
    });

    it("should set and get a gauge value", () => {
      metrics.setGauge("active_vehicles", 42);
      expect(metrics.getGauge("active_vehicles")).toBe(42);
    });

    it("should overwrite previous gauge values", () => {
      metrics.setGauge("memory", 100);
      metrics.setGauge("memory", 200);
      expect(metrics.getGauge("memory")).toBe(200);
    });

    it("should support multiple independent gauges", () => {
      metrics.setGauge("cpu", 50);
      metrics.setGauge("memory", 70);
      expect(metrics.getGauge("cpu")).toBe(50);
      expect(metrics.getGauge("memory")).toBe(70);
    });

    it("should handle zero and negative values", () => {
      metrics.setGauge("temperature", -10);
      expect(metrics.getGauge("temperature")).toBe(-10);

      metrics.setGauge("temperature", 0);
      expect(metrics.getGauge("temperature")).toBe(0);
    });
  });

  // ─── JSON output ────────────────────────────────────────────────────

  describe("toJSON", () => {
    it("should return an empty snapshot when no metrics exist", () => {
      const snap = metrics.toJSON();
      expect(snap.histograms).toEqual({});
      expect(snap.counters).toEqual({});
      expect(snap.gauges).toEqual({});
      expect(snap.timestamp).toBeDefined();
    });

    it("should include all metric types in the snapshot", () => {
      metrics.observeHistogram("latency", 10);
      metrics.observeHistogram("latency", 20);
      metrics.incrementCounter("requests", 5);
      metrics.setGauge("vehicles", 100);

      const snap = metrics.toJSON();

      expect(snap.histograms["latency"]).toBeDefined();
      expect(snap.histograms["latency"].count).toBe(2);
      expect(snap.histograms["latency"].p50).toBe(15);

      expect(snap.counters["requests"]).toBe(5);
      expect(snap.gauges["vehicles"]).toBe(100);
    });

    it("should include a valid ISO timestamp", () => {
      const snap = metrics.toJSON();
      const parsed = new Date(snap.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  // ─── Prometheus output ──────────────────────────────────────────────

  describe("toPrometheus", () => {
    it("should produce valid Prometheus text format for histograms", () => {
      metrics.observeHistogram("pathfinding.latency_ms", 10);
      metrics.observeHistogram("pathfinding.latency_ms", 20);

      const output = metrics.toPrometheus();

      // Dots should be replaced with underscores
      expect(output).toContain("pathfinding_latency_ms");
      expect(output).toContain('quantile="0.5"');
      expect(output).toContain('quantile="0.95"');
      expect(output).toContain('quantile="0.99"');
      expect(output).toContain("_sum");
      expect(output).toContain("_count");
      expect(output).toContain("# TYPE pathfinding_latency_ms summary");
    });

    it("should produce valid Prometheus text format for counters", () => {
      metrics.incrementCounter("pathfinding.total", 42);

      const output = metrics.toPrometheus();

      expect(output).toContain("# TYPE pathfinding_total counter");
      expect(output).toContain("pathfinding_total 42");
    });

    it("should produce valid Prometheus text format for gauges", () => {
      metrics.setGauge("active-vehicles", 10);

      const output = metrics.toPrometheus();

      // Dashes should be replaced with underscores
      expect(output).toContain("# TYPE active_vehicles gauge");
      expect(output).toContain("active_vehicles 10");
    });

    it("should produce an empty output when no metrics exist", () => {
      const output = metrics.toPrometheus();
      expect(output).toBe("\n");
    });

    it("should end with a newline", () => {
      metrics.incrementCounter("test", 1);
      const output = metrics.toPrometheus();
      expect(output.endsWith("\n")).toBe(true);
    });
  });

  // ─── Singleton ──────────────────────────────────────────────────────

  describe("singleton", () => {
    it("should return the same instance from getInstance", () => {
      const a = MetricsCollector.getInstance();
      const b = MetricsCollector.getInstance();
      expect(a).toBe(b);
    });

    it("should return a fresh instance after resetInstance", () => {
      const a = MetricsCollector.getInstance();
      a.incrementCounter("test", 1);

      MetricsCollector.resetInstance();

      const b = MetricsCollector.getInstance();
      expect(b).not.toBe(a);
      expect(b.getCounter("test")).toBe(0);
    });
  });

  // ─── Reset ──────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should clear all metrics", () => {
      metrics.observeHistogram("latency", 10);
      metrics.incrementCounter("requests", 5);
      metrics.setGauge("vehicles", 100);

      metrics.reset();

      expect(metrics.getHistogram("latency")).toBeNull();
      expect(metrics.getCounter("requests")).toBe(0);
      expect(metrics.getGauge("vehicles")).toBe(0);
    });
  });
});

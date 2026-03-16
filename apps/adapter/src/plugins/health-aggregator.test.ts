import { describe, it, expect, vi } from "vitest";
import { HealthAggregator } from "./health-aggregator";
import type { DataSource, DataSink, PluginInfo } from "./types";

function createMockSource(overrides?: Partial<DataSource>): DataSource {
  return {
    type: "mock-source",
    name: "Mock Source",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    getVehicles: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

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

const emptyInfos: PluginInfo[] = [];

describe("HealthAggregator", () => {
  const aggregator = new HealthAggregator();

  describe("source health", () => {
    it("returns null source status when no source is active", async () => {
      const status = await aggregator.getStatus(null, new Map(), emptyInfos, emptyInfos);

      expect(status.source).toBeNull();
    });

    it("reports healthy source", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, message: "connected" }),
      });

      const status = await aggregator.getStatus(source, new Map(), emptyInfos, emptyInfos);

      expect(status.source).toEqual({
        type: "mock-source",
        healthy: true,
        message: "connected",
      });
    });

    it("reports unhealthy source", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockResolvedValue({ healthy: false, message: "connection refused" }),
      });

      const status = await aggregator.getStatus(source, new Map(), emptyInfos, emptyInfos);

      expect(status.source).toEqual({
        type: "mock-source",
        healthy: false,
        message: "connection refused",
      });
    });

    it("handles source health check that throws", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockRejectedValue(new Error("timeout")),
      });

      const status = await aggregator.getStatus(source, new Map(), emptyInfos, emptyInfos);

      expect(status.source).toEqual({
        type: "mock-source",
        healthy: false,
        message: "timeout",
      });
    });

    it("handles non-Error thrown from source health check", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockRejectedValue("string error"),
      });

      const status = await aggregator.getStatus(source, new Map(), emptyInfos, emptyInfos);

      expect(status.source).toEqual({
        type: "mock-source",
        healthy: false,
        message: "string error",
      });
    });
  });

  describe("sink health", () => {
    it("returns empty sinks array when no sinks are active", async () => {
      const status = await aggregator.getStatus(null, new Map(), emptyInfos, emptyInfos);

      expect(status.sinks).toEqual([]);
    });

    it("reports health for multiple sinks", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "console",
          createMockSink({
            healthCheck: vi.fn().mockResolvedValue({ healthy: true, message: "ok" }),
          }),
        ],
        [
          "webhook",
          createMockSink({
            healthCheck: vi.fn().mockResolvedValue({ healthy: false, message: "unreachable" }),
          }),
        ],
      ]);

      const status = await aggregator.getStatus(null, sinks, emptyInfos, emptyInfos);

      expect(status.sinks).toEqual([
        { type: "console", healthy: true, message: "ok" },
        { type: "webhook", healthy: false, message: "unreachable" },
      ]);
    });

    it("handles sink health check that throws", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "broken",
          createMockSink({
            healthCheck: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
          }),
        ],
      ]);

      const status = await aggregator.getStatus(null, sinks, emptyInfos, emptyInfos);

      expect(status.sinks).toEqual([
        { type: "broken", healthy: false, message: "ECONNREFUSED" },
      ]);
    });

    it("handles non-Error thrown from sink health check", async () => {
      const sinks = new Map<string, DataSink>([
        [
          "broken",
          createMockSink({
            healthCheck: vi.fn().mockRejectedValue(42),
          }),
        ],
      ]);

      const status = await aggregator.getStatus(null, sinks, emptyInfos, emptyInfos);

      expect(status.sinks).toEqual([
        { type: "broken", healthy: false, message: "42" },
      ]);
    });
  });

  describe("available plugins passthrough", () => {
    it("passes through available sources and sinks", async () => {
      const availableSources: PluginInfo[] = [
        { type: "graphql", name: "GraphQL Source", configSchema: [] },
        { type: "rest", name: "REST Source", configSchema: [] },
      ];
      const availableSinks: PluginInfo[] = [
        { type: "console", name: "Console Sink", configSchema: [] },
      ];

      const status = await aggregator.getStatus(
        null,
        new Map(),
        availableSources,
        availableSinks
      );

      expect(status.availableSources).toBe(availableSources);
      expect(status.availableSinks).toBe(availableSinks);
    });
  });

  describe("combined status", () => {
    it("reports complete status with source, sinks, and available plugins", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      });
      const sinks = new Map<string, DataSink>([
        [
          "console",
          createMockSink({
            healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
          }),
        ],
      ]);
      const availableSources: PluginInfo[] = [
        { type: "graphql", name: "GraphQL", configSchema: [] },
      ];
      const availableSinks: PluginInfo[] = [
        { type: "console", name: "Console", configSchema: [] },
      ];

      const status = await aggregator.getStatus(
        source,
        sinks,
        availableSources,
        availableSinks
      );

      expect(status.source).toBeTruthy();
      expect(status.source!.healthy).toBe(true);
      expect(status.sinks).toHaveLength(1);
      expect(status.availableSources).toHaveLength(1);
      expect(status.availableSinks).toHaveLength(1);
    });
  });
});

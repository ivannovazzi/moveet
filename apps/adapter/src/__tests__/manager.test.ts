import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager } from "../plugins/manager";
import type { DataSource, DataSink, ConfigField } from "../plugins/types";
import type { ExportVehicle, VehicleUpdate } from "../types";

function createMockSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    type: "mock-source",
    name: "Mock Source",
    configSchema: [],
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getVehicles: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

function createMockSink(overrides: Partial<DataSink> = {}): DataSink {
  return {
    type: "mock-sink",
    name: "Mock Sink",
    configSchema: [],
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    publishUpdates: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  describe("source management", () => {
    it("registers and activates a source", async () => {
      const source = createMockSource();
      manager.registerSource("test", () => source);
      await manager.setSource("test", { url: "http://example.com" });

      expect(source.connect).toHaveBeenCalledWith({ url: "http://example.com" });
      const config = manager.getConfig();
      expect(config.activeSource).toBe("test");
    });

    it("throws on unknown source type", async () => {
      await expect(manager.setSource("nonexistent")).rejects.toThrow(
        "Unknown source type: nonexistent"
      );
    });

    it("disconnects previous source when switching", async () => {
      const source1 = createMockSource();
      const source2 = createMockSource({ type: "mock-source-2" });
      manager.registerSource("s1", () => source1);
      manager.registerSource("s2", () => source2);

      await manager.setSource("s1");
      await manager.setSource("s2");

      expect(source1.disconnect).toHaveBeenCalled();
      expect(source2.connect).toHaveBeenCalled();
    });

    it("returns vehicles from active source", async () => {
      const vehicles: ExportVehicle[] = [{ id: "v1", name: "Vehicle 1", position: [-1.3, 36.8] }];
      const source = createMockSource({ getVehicles: vi.fn().mockResolvedValue(vehicles) });
      manager.registerSource("test", () => source);
      await manager.setSource("test");

      const result = await manager.getVehicles();
      expect(result).toEqual(vehicles);
    });

    it("returns empty array when no source configured", async () => {
      expect(await manager.getVehicles()).toEqual([]);
    });
  });

  describe("sink management", () => {
    it("registers and activates a sink", async () => {
      const sink = createMockSink();
      manager.registerSink("test", () => sink);
      await manager.addSink("test", { url: "http://example.com" });

      expect(sink.connect).toHaveBeenCalledWith({ url: "http://example.com" });
      const config = manager.getConfig();
      expect(config.activeSinks).toContain("test");
    });

    it("throws on unknown sink type", async () => {
      await expect(manager.addSink("nonexistent")).rejects.toThrow(
        "Unknown sink type: nonexistent"
      );
    });

    it("replaces existing sink of same type", async () => {
      const sink1 = createMockSink();
      const sink2 = createMockSink();
      manager.registerSink("test", () => sink2);
      // First call creates sink1 via factory
      manager.registerSink("test", () => sink1);
      await manager.addSink("test");
      // Re-register with sink2 factory and add again
      manager.registerSink("test", () => sink2);
      await manager.addSink("test");

      expect(sink1.disconnect).toHaveBeenCalled();
    });

    it("removes a sink", async () => {
      const sink = createMockSink();
      manager.registerSink("test", () => sink);
      await manager.addSink("test");
      await manager.removeSink("test");

      expect(sink.disconnect).toHaveBeenCalled();
      const config = manager.getConfig();
      expect(config.activeSinks).not.toContain("test");
    });

    it("supports multiple sinks simultaneously", async () => {
      const sink1 = createMockSink({ type: "sink1" });
      const sink2 = createMockSink({ type: "sink2" });
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);
      await manager.addSink("s1");
      await manager.addSink("s2");

      const config = manager.getConfig();
      expect(config.activeSinks).toEqual(["s1", "s2"]);
    });
  });

  describe("publishing", () => {
    it("fans out updates to all active sinks", async () => {
      const sink1 = createMockSink({ type: "sink1" });
      const sink2 = createMockSink({ type: "sink2" });
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);
      await manager.addSink("s1");
      await manager.addSink("s2");

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.3, longitude: 36.8 }];
      await manager.publishUpdates(updates);

      expect(sink1.publishUpdates).toHaveBeenCalledWith(updates);
      expect(sink2.publishUpdates).toHaveBeenCalledWith(updates);
    });

    it("continues publishing if one sink fails", async () => {
      const sink1 = createMockSink({
        type: "sink1",
        publishUpdates: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const sink2 = createMockSink({ type: "sink2" });
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);
      await manager.addSink("s1");
      await manager.addSink("s2");

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.3, longitude: 36.8 }];
      await manager.publishUpdates(updates);

      expect(sink2.publishUpdates).toHaveBeenCalledWith(updates);
    });
  });

  describe("status", () => {
    it("reports health of active source and sinks", async () => {
      const source = createMockSource();
      const sink = createMockSink();
      manager.registerSource("src", () => source);
      manager.registerSink("snk", () => sink);
      await manager.setSource("src");
      await manager.addSink("snk");

      const status = await manager.getStatus();
      expect(status.source).toEqual({ type: "mock-source", healthy: true });
      expect(status.sinks).toEqual([{ type: "snk", healthy: true }]);
      expect(status.availableSources.length).toBeGreaterThan(0);
      expect(status.availableSinks.length).toBeGreaterThan(0);
    });

    it("reports available plugins with config schemas", async () => {
      const schema: ConfigField[] = [{ name: "url", label: "URL", type: "string", required: true }];
      const source = createMockSource({ configSchema: schema });
      manager.registerSource("src", () => source);

      const status = await manager.getStatus();
      expect(status.availableSources[0].configSchema).toEqual(schema);
    });

    it("handles health check failures gracefully", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockRejectedValue(new Error("fail")),
      });
      manager.registerSource("src", () => source);
      await manager.setSource("src");

      const status = await manager.getStatus();
      expect(status.source!.healthy).toBe(false);
    });

    it("reports null source when none configured", async () => {
      const status = await manager.getStatus();
      expect(status.source).toBeNull();
    });
  });

  describe("shutdown", () => {
    it("disconnects all active plugins", async () => {
      const source = createMockSource();
      const sink1 = createMockSink({ type: "sink1" });
      const sink2 = createMockSink({ type: "sink2" });
      manager.registerSource("src", () => source);
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);
      await manager.setSource("src");
      await manager.addSink("s1");
      await manager.addSink("s2");

      await manager.shutdown();

      expect(source.disconnect).toHaveBeenCalled();
      expect(sink1.disconnect).toHaveBeenCalled();
      expect(sink2.disconnect).toHaveBeenCalled();
    });
  });
});

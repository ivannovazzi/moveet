import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "./manager";
import type { DataSource, DataSink } from "./types";
import type { VehicleUpdate } from "../types";

function createMockSource(overrides?: Partial<DataSource>): DataSource {
  return {
    type: "mock",
    name: "Mock Source",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    getVehicles: vi.fn().mockResolvedValue([{ id: "v1", name: "V1", position: [36.8, -1.28] }]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

function createMockSink(overrides?: Partial<DataSink>): DataSink {
  return {
    type: "mock",
    name: "Mock Sink",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
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
    it("registers and sets a source", async () => {
      const source = createMockSource();
      manager.registerSource("mock", () => source);

      await manager.setSource("mock", { count: 10 });

      expect(source.connect).toHaveBeenCalledWith({ count: 10 });
      const vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(1);
    });

    it("throws on unknown source type", async () => {
      await expect(manager.setSource("unknown", {})).rejects.toThrow(
        "Unknown source type: unknown"
      );
    });

    it("disconnects previous source when setting new one", async () => {
      const source1 = createMockSource();
      const source2 = createMockSource({ type: "mock2" });

      manager.registerSource("mock1", () => source1);
      manager.registerSource("mock2", () => source2);

      await manager.setSource("mock1", {});
      await manager.setSource("mock2", {});

      expect(source1.disconnect).toHaveBeenCalled();
    });

    it("returns empty array when no source set", async () => {
      const vehicles = await manager.getVehicles();
      expect(vehicles).toEqual([]);
    });
  });

  describe("sink management", () => {
    it("registers and adds a sink", async () => {
      const sink = createMockSink();
      manager.registerSink("mock", () => sink);

      await manager.addSink("mock", { verbose: true });

      expect(sink.connect).toHaveBeenCalledWith({ verbose: true });
    });

    it("throws on unknown sink type", async () => {
      await expect(manager.addSink("unknown", {})).rejects.toThrow("Unknown sink type: unknown");
    });

    it("replaces existing sink of same type", async () => {
      const sink1 = createMockSink();
      const sink2 = createMockSink();

      let callCount = 0;
      manager.registerSink("mock", () => (callCount++ === 0 ? sink1 : sink2));

      await manager.addSink("mock", {});
      await manager.addSink("mock", {});

      expect(sink1.disconnect).toHaveBeenCalled();
    });

    it("removes a sink", async () => {
      const sink = createMockSink();
      manager.registerSink("mock", () => sink);

      await manager.addSink("mock", {});
      await manager.removeSink("mock");

      expect(sink.disconnect).toHaveBeenCalled();
      const config = manager.getConfig();
      expect(config.activeSinks).not.toContain("mock");
    });

    it("publishes updates to all active sinks", async () => {
      const sink1 = createMockSink({ type: "s1" });
      const sink2 = createMockSink({ type: "s2" });

      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);

      await manager.addSink("s1", {});
      await manager.addSink("s2", {});

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      await manager.publishUpdates(updates);

      expect(sink1.publishUpdates).toHaveBeenCalledWith(updates);
      expect(sink2.publishUpdates).toHaveBeenCalledWith(updates);
    });

    it("continues publishing even if one sink errors", async () => {
      const failSink = createMockSink({
        type: "fail",
        publishUpdates: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const okSink = createMockSink({ type: "ok" });

      manager.registerSink("fail", () => failSink);
      manager.registerSink("ok", () => okSink);

      await manager.addSink("fail", {});
      await manager.addSink("ok", {});

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      await manager.publishUpdates(updates);

      expect(okSink.publishUpdates).toHaveBeenCalledWith(updates);
    });
  });

  describe("status and config", () => {
    it("reports status with source and sinks health", async () => {
      const source = createMockSource();
      const sink = createMockSink();

      manager.registerSource("mock", () => source);
      manager.registerSink("mock", () => sink);

      await manager.setSource("mock", {});
      await manager.addSink("mock", {});

      const status = await manager.getStatus();
      expect(status.source).toMatchObject({ type: "mock", healthy: true });
      expect(status.sinks).toEqual([expect.objectContaining({ type: "mock", healthy: true })]);
    });

    it("reports null source when none set", async () => {
      const status = await manager.getStatus();
      expect(status.source).toBeNull();
    });

    it("getConfig returns active source and sinks", async () => {
      const source = createMockSource();
      const sink = createMockSink();

      manager.registerSource("mock", () => source);
      manager.registerSink("mock", () => sink);

      await manager.setSource("mock", { foo: "bar" });
      await manager.addSink("mock", { baz: 1 });

      const config = manager.getConfig();
      expect(config.activeSource).toBe("mock");
      expect(config.activeSinks).toEqual(["mock"]);
      expect(config.sourceConfig.mock).toEqual({ foo: "bar" });
      expect(config.sinkConfig.mock).toEqual({ baz: 1 });
    });
  });

  // === Issue .4: publish result reporting ===

  describe("publish result reporting", () => {
    it("returns success when all sinks succeed", async () => {
      const sink1 = createMockSink({ type: "s1" });
      const sink2 = createMockSink({ type: "s2" });
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);
      await manager.addSink("s1", {});
      await manager.addSink("s2", {});

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("success");
      expect(result.sinks).toEqual([
        { type: "s1", success: true },
        { type: "s2", success: true },
      ]);
    });

    it("returns partial when some sinks fail", async () => {
      const failSink = createMockSink({
        type: "fail",
        publishUpdates: vi.fn().mockRejectedValue(new Error("network error")),
      });
      const okSink = createMockSink({ type: "ok" });
      manager.registerSink("fail", () => failSink);
      manager.registerSink("ok", () => okSink);
      await manager.addSink("fail", {});
      await manager.addSink("ok", {});

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("partial");
      expect(result.sinks).toContainEqual({ type: "fail", success: false, error: "network error" });
      expect(result.sinks).toContainEqual({ type: "ok", success: true });
    });

    it("returns failure when all sinks fail", async () => {
      const fail1 = createMockSink({
        type: "f1",
        publishUpdates: vi.fn().mockRejectedValue(new Error("err1")),
      });
      const fail2 = createMockSink({
        type: "f2",
        publishUpdates: vi.fn().mockRejectedValue(new Error("err2")),
      });
      manager.registerSink("f1", () => fail1);
      manager.registerSink("f2", () => fail2);
      await manager.addSink("f1", {});
      await manager.addSink("f2", {});

      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("failure");
      expect(result.sinks).toContainEqual({ type: "f1", success: false, error: "err1" });
      expect(result.sinks).toContainEqual({ type: "f2", success: false, error: "err2" });
    });

    it("returns success with empty sinks when none configured", async () => {
      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("success");
      expect(result.sinks).toEqual([]);
    });
  });

  // === Issue .5: health diagnostics ===

  describe("health diagnostics", () => {
    it("exposes diagnostic message from source health check", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockResolvedValue({ healthy: false, message: "connection refused" }),
      });
      manager.registerSource("mock", () => source);
      await manager.setSource("mock", {});

      const status = await manager.getStatus();

      expect(status.source).toEqual({
        type: "mock",
        healthy: false,
        message: "connection refused",
      });
    });

    it("exposes diagnostic message from sink health check", async () => {
      const sink = createMockSink({
        healthCheck: vi.fn().mockResolvedValue({ healthy: true, message: "reachable" }),
      });
      manager.registerSink("mock", () => sink);
      await manager.addSink("mock", {});

      const status = await manager.getStatus();

      expect(status.sinks).toEqual([{ type: "mock", healthy: true, message: "reachable" }]);
    });

    it("captures error message when health check throws", async () => {
      const source = createMockSource({
        healthCheck: vi.fn().mockRejectedValue(new Error("timeout")),
      });
      manager.registerSource("mock", () => source);
      await manager.setSource("mock", {});

      const status = await manager.getStatus();

      expect(status.source).toEqual({ type: "mock", healthy: false, message: "timeout" });
    });
  });

  describe("atomic reconfiguration", () => {
    it("preserves active source when replacement fails to connect", async () => {
      const goodSource = createMockSource();
      const badSource = createMockSource({
        connect: vi.fn().mockRejectedValue(new Error("connection refused")),
      });

      manager.registerSource("good", () => goodSource);
      manager.registerSource("bad", () => badSource);

      await manager.setSource("good", {});

      await expect(manager.setSource("bad", {})).rejects.toThrow("connection refused");

      // Original source should still be active and NOT disconnected
      expect(goodSource.disconnect).not.toHaveBeenCalled();
      const vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(1);

      // Config should still reflect the good source
      const config = manager.getConfig();
      expect(config.activeSource).toBe("good");
    });

    it("preserves active sink when replacement fails to connect", async () => {
      const goodSink = createMockSink();
      const badSink = createMockSink({
        connect: vi.fn().mockRejectedValue(new Error("auth failed")),
      });

      let callCount = 0;
      manager.registerSink("mock", () => (callCount++ === 0 ? goodSink : badSink));

      await manager.addSink("mock", {});

      await expect(manager.addSink("mock", { bad: true })).rejects.toThrow("auth failed");

      // Original sink should still be active and NOT disconnected
      expect(goodSink.disconnect).not.toHaveBeenCalled();

      // Original sink should still receive updates
      const updates: VehicleUpdate[] = [{ id: "v1", latitude: -1.28, longitude: 36.8 }];
      await manager.publishUpdates(updates);
      expect(goodSink.publishUpdates).toHaveBeenCalledWith(updates);
    });

    it("still replaces source successfully when old disconnect fails", async () => {
      const oldSource = createMockSource({
        disconnect: vi.fn().mockRejectedValue(new Error("disconnect error")),
      });
      const newSource = createMockSource({
        type: "new",
        getVehicles: vi
          .fn()
          .mockResolvedValue([{ id: "v2", name: "V2", status: "ONLINE", position: [36.8, -1.28] }]),
      });

      manager.registerSource("old", () => oldSource);
      manager.registerSource("new", () => newSource);

      await manager.setSource("old", {});
      // The disconnect of old may fail, but new source should still be active
      await manager.setSource("new", {});

      const vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("v2");
    });
  });

  describe("shutdown", () => {
    it("disconnects source and all sinks", async () => {
      const source = createMockSource();
      const sink1 = createMockSink({ type: "s1" });
      const sink2 = createMockSink({ type: "s2" });

      manager.registerSource("mock", () => source);
      manager.registerSink("s1", () => sink1);
      manager.registerSink("s2", () => sink2);

      await manager.setSource("mock", {});
      await manager.addSink("s1", {});
      await manager.addSink("s2", {});

      await manager.shutdown();

      expect(source.disconnect).toHaveBeenCalled();
      expect(sink1.disconnect).toHaveBeenCalled();
      expect(sink2.disconnect).toHaveBeenCalled();
    });
  });
});

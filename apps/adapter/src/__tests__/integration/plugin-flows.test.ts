import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginManager } from "../../plugins/manager";
import { StaticSource } from "../../plugins/sources/static";
import { ConsoleSink } from "../../plugins/sinks/console";
import type {
  DataSource,
  DataSink,
  ConfigField,
  HealthCheckResult,
  PluginConfig,
  SinkPublishResult,
} from "../../plugins/types";
import type { ExportVehicle, VehicleUpdate } from "../../types";

// ---------------------------------------------------------------------------
// Helpers — mock plugins for failure/custom scenarios
// ---------------------------------------------------------------------------

/** A source that returns a configurable dataset (or throws on demand). */
class ControllableSource implements DataSource {
  readonly type = "controllable";
  readonly name = "Controllable Source";
  readonly configSchema: ConfigField[] = [];

  private connected = false;
  vehicles: ExportVehicle[] = [];
  shouldFailConnect = false;
  shouldFailFetch = false;
  healthy = true;

  async connect(_config: PluginConfig): Promise<void> {
    if (this.shouldFailConnect) throw new Error("source connect failed");
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.vehicles = [];
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.connected) throw new Error("source not connected");
    if (this.shouldFailFetch) throw new Error("source fetch failed");
    return this.vehicles;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: this.healthy, message: this.healthy ? "ok" : "degraded" };
  }
}

/** A sink that records every batch it receives and can be configured to fail. */
class RecordingSink implements DataSink {
  readonly type: string;
  readonly name: string;
  readonly configSchema: ConfigField[] = [];

  received: VehicleUpdate[][] = [];
  connected = false;
  shouldFailConnect = false;
  shouldFailPublish = false;
  healthy = true;
  partialResult: SinkPublishResult | null = null;

  constructor(type: string, name?: string) {
    this.type = type;
    this.name = name ?? `Recording Sink (${type})`;
  }

  async connect(_config: PluginConfig): Promise<void> {
    if (this.shouldFailConnect) throw new Error(`${this.type} connect failed`);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (this.shouldFailPublish) throw new Error(`${this.type} publish failed`);
    this.received.push(updates);
    if (this.partialResult) return this.partialResult;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: this.healthy, message: this.healthy ? "ok" : "unhealthy" };
  }
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleUpdates: VehicleUpdate[] = [
  { id: "v1", latitude: -1.28, longitude: 36.8, type: "car" },
  { id: "v2", latitude: -1.3, longitude: 36.82, type: "truck" },
  { id: "v3", latitude: -1.29, longitude: 36.81, type: "motorcycle" },
];

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Plugin flow integration tests", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  // -----------------------------------------------------------------------
  // 1. Full sync flow: source fetch -> publish to multiple sinks
  // -----------------------------------------------------------------------

  describe("full sync flow: source fetch -> publish to multiple sinks", () => {
    it("fetches from static source and publishes to multiple recording sinks", async () => {
      // Register real StaticSource
      manager.registerSource("static", () => new StaticSource());

      // Register two recording sinks
      const sinkA = new RecordingSink("sink-a");
      const sinkB = new RecordingSink("sink-b");
      manager.registerSink("sink-a", () => sinkA);
      manager.registerSink("sink-b", () => sinkB);

      // Wire up
      await manager.setSource("static", { count: 5 });
      await manager.addSink("sink-a", {});
      await manager.addSink("sink-b", {});

      // Fetch from source
      const vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(5);
      expect(vehicles[0]).toHaveProperty("id");
      expect(vehicles[0]).toHaveProperty("name");

      // Convert to updates and publish
      const updates: VehicleUpdate[] = vehicles.map((v) => ({
        id: v.id,
        latitude: v.position?.[0] ?? 0,
        longitude: v.position?.[1] ?? 0,
        type: v.type,
      }));

      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("success");
      expect(result.sinks).toHaveLength(2);
      expect(sinkA.received).toHaveLength(1);
      expect(sinkA.received[0]).toHaveLength(5);
      expect(sinkB.received).toHaveLength(1);
      expect(sinkB.received[0]).toHaveLength(5);
    });

    it("full round-trip with real ConsoleSink (no crash)", async () => {
      // Suppress console.log for ConsoleSink output during test
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      manager.registerSource("static", () => new StaticSource());
      manager.registerSink("console", () => new ConsoleSink());

      await manager.setSource("static", { count: 3 });
      await manager.addSink("console", { verbose: true });

      const vehicles = await manager.getVehicles();
      const updates: VehicleUpdate[] = vehicles.map((v) => ({
        id: v.id,
        latitude: v.position?.[0] ?? 0,
        longitude: v.position?.[1] ?? 0,
      }));

      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("success");
      expect(result.sinks).toHaveLength(1);
      expect(result.sinks[0]).toMatchObject({ type: "console", success: true });

      // ConsoleSink should have logged something
      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it("publishes same batch to three sinks concurrently", async () => {
      const sinks = ["alpha", "beta", "gamma"].map((id) => new RecordingSink(id));
      for (const sink of sinks) {
        manager.registerSink(sink.type, () => sink);
        await manager.addSink(sink.type, {});
      }

      const result = await manager.publishUpdates(sampleUpdates);

      expect(result.status).toBe("success");
      expect(result.sinks).toHaveLength(3);
      for (const sink of sinks) {
        expect(sink.received).toHaveLength(1);
        expect(sink.received[0]).toEqual(sampleUpdates);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Plugin switching at runtime
  // -----------------------------------------------------------------------

  describe("plugin switching at runtime", () => {
    it("switches source at runtime and fetches from new source", async () => {
      const sourceA = new ControllableSource();
      sourceA.vehicles = [{ id: "a1", name: "A1", position: [-1.28, 36.8], type: "car" }];

      const sourceB = new ControllableSource();
      sourceB.vehicles = [
        { id: "b1", name: "B1", position: [-1.3, 36.82], type: "truck" },
        { id: "b2", name: "B2", position: [-1.31, 36.83], type: "bus" },
      ];

      manager.registerSource("source-a", () => sourceA);
      manager.registerSource("source-b", () => sourceB);

      await manager.setSource("source-a", {});
      let vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("a1");

      // Switch source
      await manager.setSource("source-b", {});
      vehicles = await manager.getVehicles();
      expect(vehicles).toHaveLength(2);
      expect(vehicles[0].id).toBe("b1");

      // Old source should be disconnected
      expect((sourceA as any).connected).toBe(false);

      // Config should reflect the new source
      const config = manager.getConfig();
      expect(config.activeSource).toBe("source-b");
    });

    it("adds and removes sinks dynamically while continuing to publish", async () => {
      const sinkA = new RecordingSink("sink-a");
      const sinkB = new RecordingSink("sink-b");
      manager.registerSink("sink-a", () => sinkA);
      manager.registerSink("sink-b", () => sinkB);

      // Start with one sink
      await manager.addSink("sink-a", {});
      await manager.publishUpdates(sampleUpdates);
      expect(sinkA.received).toHaveLength(1);

      // Add second sink
      await manager.addSink("sink-b", {});
      await manager.publishUpdates(sampleUpdates);
      expect(sinkA.received).toHaveLength(2);
      expect(sinkB.received).toHaveLength(1);

      // Remove first sink
      await manager.removeSink("sink-a");
      await manager.publishUpdates(sampleUpdates);
      expect(sinkA.received).toHaveLength(2); // no new data
      expect(sinkB.received).toHaveLength(2); // received another batch

      const config = manager.getConfig();
      expect(config.activeSinks).toEqual(["sink-b"]);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Mixed success/failure (one sink fails, others succeed)
  // -----------------------------------------------------------------------

  describe("mixed success/failure scenarios", () => {
    it("returns partial when one of three sinks throws", async () => {
      const goodA = new RecordingSink("good-a");
      const bad = new RecordingSink("bad");
      bad.shouldFailPublish = true;
      const goodB = new RecordingSink("good-b");

      manager.registerSink("good-a", () => goodA);
      manager.registerSink("bad", () => bad);
      manager.registerSink("good-b", () => goodB);

      await manager.addSink("good-a", {});
      await manager.addSink("bad", {});
      await manager.addSink("good-b", {});

      const result = await manager.publishUpdates(sampleUpdates);

      expect(result.status).toBe("partial");

      const goodAResult = result.sinks.find((s) => s.type === "good-a")!;
      expect(goodAResult.success).toBe(true);

      const badResult = result.sinks.find((s) => s.type === "bad")!;
      expect(badResult.success).toBe(false);
      expect(badResult.error).toBe("bad publish failed");

      const goodBResult = result.sinks.find((s) => s.type === "good-b")!;
      expect(goodBResult.success).toBe(true);

      // Good sinks still received the data
      expect(goodA.received).toHaveLength(1);
      expect(goodB.received).toHaveLength(1);
    });

    it("returns partial with item-level failures from one sink", async () => {
      const normalSink = new RecordingSink("normal");
      const partialSink = new RecordingSink("partial");
      partialSink.partialResult = {
        attempted: 3,
        succeeded: 2,
        failures: [{ itemId: "v2", error: "timeout sending update" }],
      };

      manager.registerSink("normal", () => normalSink);
      manager.registerSink("partial", () => partialSink);

      await manager.addSink("normal", {});
      await manager.addSink("partial", {});

      const result = await manager.publishUpdates(sampleUpdates);

      expect(result.status).toBe("partial");

      const normalResult = result.sinks.find((s) => s.type === "normal")!;
      expect(normalResult.success).toBe(true);

      const partialResult = result.sinks.find((s) => s.type === "partial")!;
      expect(partialResult.success).toBe(false);
      expect(partialResult.failures).toHaveLength(1);
      expect(partialResult.failures![0].itemId).toBe("v2");
      expect(partialResult.attempted).toBe(3);
      expect(partialResult.succeeded).toBe(2);
    });

    it("returns failure when all sinks fail", async () => {
      const fail1 = new RecordingSink("fail-1");
      fail1.shouldFailPublish = true;
      const fail2 = new RecordingSink("fail-2");
      fail2.shouldFailPublish = true;

      manager.registerSink("fail-1", () => fail1);
      manager.registerSink("fail-2", () => fail2);

      await manager.addSink("fail-1", {});
      await manager.addSink("fail-2", {});

      // Suppress expected console.error from Publisher
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await manager.publishUpdates(sampleUpdates);

      expect(result.status).toBe("failure");
      expect(result.sinks).toHaveLength(2);
      expect(result.sinks.every((s) => !s.success)).toBe(true);

      errorSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // 4. Empty dataset handling (source returns 0 rows)
  // -----------------------------------------------------------------------

  describe("empty dataset handling", () => {
    it("handles source returning zero vehicles gracefully", async () => {
      const emptySource = new ControllableSource();
      emptySource.vehicles = []; // explicitly empty

      manager.registerSource("empty", () => emptySource);
      await manager.setSource("empty", {});

      const vehicles = await manager.getVehicles();
      expect(vehicles).toEqual([]);
    });

    it("publishes empty updates array to sinks without error", async () => {
      const sink = new RecordingSink("recorder");
      manager.registerSink("recorder", () => sink);
      await manager.addSink("recorder", {});

      const result = await manager.publishUpdates([]);

      expect(result.status).toBe("success");
      expect(sink.received).toHaveLength(1);
      expect(sink.received[0]).toEqual([]);
    });

    it("end-to-end: empty source -> fetch -> publish propagates empty array to sinks", async () => {
      const emptySource = new ControllableSource();
      emptySource.vehicles = [];

      const sink = new RecordingSink("recorder");

      manager.registerSource("empty", () => emptySource);
      manager.registerSink("recorder", () => sink);

      await manager.setSource("empty", {});
      await manager.addSink("recorder", {});

      const vehicles = await manager.getVehicles();
      expect(vehicles).toEqual([]);

      const updates: VehicleUpdate[] = vehicles.map((v) => ({
        id: v.id,
        latitude: v.position?.[0] ?? 0,
        longitude: v.position?.[1] ?? 0,
      }));

      const result = await manager.publishUpdates(updates);

      expect(result.status).toBe("success");
      expect(sink.received).toHaveLength(1);
      expect(sink.received[0]).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Health check aggregation across plugins
  // -----------------------------------------------------------------------

  describe("health check aggregation across plugins", () => {
    it("aggregates healthy source and multiple sinks", async () => {
      const source = new ControllableSource();
      const sinkA = new RecordingSink("sink-a");
      const sinkB = new RecordingSink("sink-b");

      manager.registerSource("controllable", () => source);
      manager.registerSink("sink-a", () => sinkA);
      manager.registerSink("sink-b", () => sinkB);

      await manager.setSource("controllable", {});
      await manager.addSink("sink-a", {});
      await manager.addSink("sink-b", {});

      const status = await manager.getStatus();

      expect(status.source).toMatchObject({
        type: "controllable",
        healthy: true,
        message: "ok",
      });
      expect(status.sinks).toHaveLength(2);
      expect(status.sinks.every((s) => s.healthy)).toBe(true);
    });

    it("reports unhealthy source alongside healthy sinks", async () => {
      const source = new ControllableSource();
      source.healthy = false;

      const sink = new RecordingSink("recorder");

      manager.registerSource("controllable", () => source);
      manager.registerSink("recorder", () => sink);

      await manager.setSource("controllable", {});
      await manager.addSink("recorder", {});

      const status = await manager.getStatus();

      expect(status.source).toMatchObject({
        type: "controllable",
        healthy: false,
        message: "degraded",
      });
      expect(status.sinks[0]).toMatchObject({
        type: "recorder",
        healthy: true,
      });
    });

    it("reports mixed sink health (one healthy, one unhealthy)", async () => {
      const healthySink = new RecordingSink("healthy");
      const unhealthySink = new RecordingSink("unhealthy");
      unhealthySink.healthy = false;

      manager.registerSink("healthy", () => healthySink);
      manager.registerSink("unhealthy", () => unhealthySink);

      await manager.addSink("healthy", {});
      await manager.addSink("unhealthy", {});

      const status = await manager.getStatus();

      expect(status.sinks).toHaveLength(2);

      const hResult = status.sinks.find((s) => s.type === "healthy")!;
      expect(hResult.healthy).toBe(true);

      const uResult = status.sinks.find((s) => s.type === "unhealthy")!;
      expect(uResult.healthy).toBe(false);
      expect(uResult.message).toBe("unhealthy");
    });

    it("includes available sources and sinks in status", async () => {
      manager.registerSource("static", () => new StaticSource());
      manager.registerSink("console", () => new ConsoleSink());

      const status = await manager.getStatus();

      expect(status.source).toBeNull(); // no active source
      expect(status.availableSources.length).toBeGreaterThanOrEqual(1);
      expect(status.availableSinks.length).toBeGreaterThanOrEqual(1);

      const staticInfo = status.availableSources.find((s) => s.type === "static");
      expect(staticInfo).toBeDefined();
      expect(staticInfo!.name).toBe("Static Test Data");

      const consoleInfo = status.availableSinks.find((s) => s.type === "console");
      expect(consoleInfo).toBeDefined();
      expect(consoleInfo!.name).toBe("Console Logger");
    });

    it("health status updates after dynamic reconfiguration", async () => {
      const source = new ControllableSource();
      const sink = new RecordingSink("recorder");

      manager.registerSource("controllable", () => source);
      manager.registerSink("recorder", () => sink);

      // Initially no source, no sinks
      let status = await manager.getStatus();
      expect(status.source).toBeNull();
      expect(status.sinks).toHaveLength(0);

      // Add source
      await manager.setSource("controllable", {});
      status = await manager.getStatus();
      expect(status.source).toMatchObject({ type: "controllable", healthy: true });

      // Add sink
      await manager.addSink("recorder", {});
      status = await manager.getStatus();
      expect(status.sinks).toHaveLength(1);

      // Mark source unhealthy
      source.healthy = false;
      status = await manager.getStatus();
      expect(status.source!.healthy).toBe(false);

      // Remove sink
      await manager.removeSink("recorder");
      status = await manager.getStatus();
      expect(status.sinks).toHaveLength(0);
    });
  });
});

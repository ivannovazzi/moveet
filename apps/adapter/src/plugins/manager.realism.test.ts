import { describe, it, expect } from "vitest";
import { PluginManager } from "./manager";
import type { DataSink } from "./types";

function fakeSink(): DataSink & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    type: "fake",
    name: "fake",
    configSchema: [],
    calls,
    async connect() {},
    async disconnect() {},
    async publishUpdates(u) {
      calls.push(u as unknown[]);
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
}

describe("PluginManager realism integration", () => {
  it("passthrough when realism disabled: publishUpdates reaches sinks", async () => {
    const pm = new PluginManager();
    const sink = fakeSink();
    pm.registerSink("fake", () => sink);
    await pm.addSink("fake", {});
    await pm.publishUpdates([{ id: "v1", latitude: 1, longitude: 2 }]);
    const status = pm.getRealismStatus();
    expect(status.enabled).toBe(false);
    // Passthrough must actually deliver the update to the sink.
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]).toEqual([{ id: "v1", latitude: 1, longitude: 2 }]);
  });

  it("setRealismConfig enables and reports status", async () => {
    const pm = new PluginManager();
    const cfg = pm.setRealismConfig({ enabled: true });
    expect(cfg.enabled).toBe(true);
    expect(pm.getRealismStatus().enabled).toBe(true);
    await pm.shutdown();
  });

  it("getRealismConfig returns the current resolved config", async () => {
    const pm = new PluginManager();
    const cfg = pm.getRealismConfig();
    expect(cfg.enabled).toBe(false);
    expect(typeof cfg.reportingPeriodMs).toBe("number");
  });
});

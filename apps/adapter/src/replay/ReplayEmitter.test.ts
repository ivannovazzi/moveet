import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { VehicleUpdate } from "../types";
import { ReplayEmitter } from "./ReplayEmitter";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "__fixtures__", "tiny.ndjson");

// The fixture's sim-time range (inclusive). Every emitted fix timestamp must
// fall within this window — never a wall-clock value near Date.now().
const SIM_START = Date.parse("2026-05-25T00:00:00.000Z");
const SIM_END = Date.parse("2026-05-25T00:00:02.000Z");

function mockPublish() {
  const batches: VehicleUpdate[][] = [];
  const publish = vi.fn(async (updates: VehicleUpdate[]) => {
    // clone so later mutation can't retroactively change captured batches
    batches.push(updates.map((u) => ({ ...u })));
    return { status: "success" as const, sinks: [] };
  });
  return { publish, batches, all: () => batches.flat() };
}

describe("ReplayEmitter (realism off)", () => {
  it("emits every vehicle of every record stamped with the record's sim time", async () => {
    const { publish, batches, all } = mockPublish();
    const emitter = new ReplayEmitter({ ndjsonPath: FIXTURE, realism: false, publish });
    await emitter.run();

    // realism-off: one publish per record, all vehicles passed through.
    expect(batches.length).toBe(3);
    const updates = all();
    // 3 records x 2 vehicles
    expect(updates.length).toBe(6);

    const validTs = new Set([SIM_START, SIM_START + 1000, SIM_START + 2000]);
    for (const u of updates) {
      expect(typeof u.timestamp).toBe("number");
      expect(validTs.has(u.timestamp!)).toBe(true);
      // never a wall-clock value
      expect(u.timestamp).toBeLessThanOrEqual(SIM_END);
      expect(u.timestamp).toBeGreaterThanOrEqual(SIM_START);
    }
  });

  it("maps the NDJSON vehicle shape to VehicleUpdate correctly", async () => {
    const { publish, batches } = mockPublish();
    const emitter = new ReplayEmitter({ ndjsonPath: FIXTURE, realism: false, publish });
    await emitter.run();

    const first = batches[0].find((u) => u.id === "v1")!;
    expect(first.latitude).toBe(-1.2921); // position[0]
    expect(first.longitude).toBe(36.8219); // position[1]
    expect(first.speed).toBe(42.1); // km/h passthrough
    expect(first.heading).toBe(270);
    expect(first.timestamp).toBe(SIM_START);

    // ignition:false carries through as connected:false
    const v2 = batches[0].find((u) => u.id === "v2")!;
    expect(v2.connected).toBe(false);
  });
});

describe("ReplayEmitter (realism on)", () => {
  it("emits only sim-time timestamps through the realism engine", async () => {
    const { publish, all } = mockPublish();
    const emitter = new ReplayEmitter({
      ndjsonPath: FIXTURE,
      realism: true,
      seed: 12345,
      // Tight reporting period so the short fixture produces emissions.
      realismConfig: { enabled: true, reportingPeriodMs: 1000, jitterMs: 0, emitStaleAfterMs: 0 },
      publish,
    });
    await emitter.run();

    const updates = all();
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(typeof u.timestamp).toBe("number");
      expect(u.timestamp).toBeGreaterThanOrEqual(SIM_START);
      expect(u.timestamp).toBeLessThanOrEqual(SIM_END);
    }
  });

  it("is deterministic for a fixed seed (identical timestamps and positions)", async () => {
    async function runOnce() {
      const { publish, all } = mockPublish();
      const emitter = new ReplayEmitter({
        ndjsonPath: FIXTURE,
        realism: true,
        seed: 999,
        realismConfig: { enabled: true, reportingPeriodMs: 1000, jitterMs: 0, emitStaleAfterMs: 0 },
        publish,
      });
      await emitter.run();
      return all().map((u) => ({ id: u.id, t: u.timestamp, lat: u.latitude, lon: u.longitude }));
    }
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("does not start a real setInterval (autoStart:false path)", async () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const { publish } = mockPublish();
    const emitter = new ReplayEmitter({
      ndjsonPath: FIXTURE,
      realism: true,
      seed: 1,
      realismConfig: { enabled: true, reportingPeriodMs: 1000, jitterMs: 0, emitStaleAfterMs: 0 },
      publish,
    });
    await emitter.run();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

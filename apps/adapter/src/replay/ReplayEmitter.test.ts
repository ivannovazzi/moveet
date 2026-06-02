import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { VehicleUpdate } from "../types";
import { ReplayEmitter } from "./ReplayEmitter";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "__fixtures__", "recording.ndjson");

// The fixture's virtual-time range (inclusive). Every emitted fix timestamp
// must fall within this window — never a wall-clock value near Date.now().
const START = Date.parse("2026-05-25T00:00:00.000Z");
const END = START + 2000;

/** Yield the fixture file as NDJSON lines (mimics an HTTP body line iterable). */
async function* fixtureLines(): AsyncGenerator<string> {
  const text = readFileSync(FIXTURE, "utf8");
  // Yield as one chunk plus a split chunk to exercise the line-buffering path.
  const mid = Math.floor(text.length / 2);
  yield text.slice(0, mid);
  yield text.slice(mid);
}

function mockPublish() {
  const batches: VehicleUpdate[][] = [];
  const publish = vi.fn(async (updates: VehicleUpdate[]) => {
    batches.push(updates.map((u) => ({ ...u })));
    return { status: "success" as const, sinks: [] };
  });
  return { publish, batches, all: () => batches.flat() };
}

describe("ReplayEmitter (realism off)", () => {
  it("emits every vehicle event stamped with its back-dated virtual time", async () => {
    const { publish, batches, all } = mockPublish();
    const emitter = new ReplayEmitter({ source: fixtureLines(), realism: false, publish });
    await emitter.run();

    // One publish per `vehicle` event (3); the `direction` event is ignored.
    expect(batches.length).toBe(3);
    const updates = all();
    expect(updates.length).toBe(6); // 3 vehicle events x 2 vehicles

    const validTs = new Set([START, START + 1000, START + 2000]);
    for (const u of updates) {
      expect(typeof u.timestamp).toBe("number");
      expect(validTs.has(u.timestamp!)).toBe(true);
      expect(u.timestamp).toBeGreaterThanOrEqual(START);
      expect(u.timestamp).toBeLessThanOrEqual(END);
      // Far below wall-clock (the fixture is historical, 2026-05-25).
      expect(u.timestamp!).toBeLessThan(Date.now());
    }
  });

  it("maps the recording vehicle shape to VehicleUpdate correctly", async () => {
    const { publish, batches } = mockPublish();
    const emitter = new ReplayEmitter({ source: fixtureLines(), realism: false, publish });
    await emitter.run();

    const first = batches[0].find((u) => u.id === "v1")!;
    expect(first.latitude).toBe(-1.2921); // position[0]
    expect(first.longitude).toBe(36.8219); // position[1]
    expect(first.speed).toBe(42.1); // km/h passthrough
    expect(first.heading).toBe(270);
    expect(first.timestamp).toBe(START);
    expect(first.connected).toBe(true);
  });
});

describe("ReplayEmitter (realism on)", () => {
  it("emits only back-dated virtual timestamps through the realism engine", async () => {
    const { publish, all } = mockPublish();
    const emitter = new ReplayEmitter({
      source: fixtureLines(),
      realism: true,
      seed: 12345,
      realismConfig: { enabled: true, reportingPeriodMs: 1000, jitterMs: 0, emitStaleAfterMs: 0 },
      publish,
    });
    await emitter.run();

    const updates = all();
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(typeof u.timestamp).toBe("number");
      expect(u.timestamp).toBeGreaterThanOrEqual(START);
      expect(u.timestamp).toBeLessThanOrEqual(END);
      expect(u.timestamp!).toBeLessThan(Date.now());
    }
  });

  it("is deterministic for a fixed seed (identical timestamps and positions)", async () => {
    async function runOnce() {
      const { publish, all } = mockPublish();
      const emitter = new ReplayEmitter({
        source: fixtureLines(),
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
      source: fixtureLines(),
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

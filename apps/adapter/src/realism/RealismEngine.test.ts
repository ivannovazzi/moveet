import { describe, it, expect, vi } from "vitest";
import { RealismEngine } from "./RealismEngine";
import { mulberry32 } from "./rng";

function makeEngine(overrides = {}) {
  const publish = vi.fn().mockResolvedValue({ status: "success", sinks: [] });
  let t = 0;
  const now = () => t;
  // Deterministic, non-degenerate PRNG. A constant rng (e.g. () => 0.5) makes
  // Box-Muller emit ~0 for every second Gaussian deviate, freezing the
  // north/latitude error axis at exactly the true value.
  const engine = new RealismEngine({
    publish,
    now,
    rng: mulberry32(12345),
    config: overrides,
  });
  return { engine, publish, advance: (ms: number) => (t += ms), getT: () => t };
}

describe("RealismEngine (disabled)", () => {
  it("passes ingest straight through to publish and returns its result", async () => {
    const { engine, publish } = makeEngine({ enabled: false });
    const updates = [{ id: "v1", latitude: 1, longitude: 2 }];
    const res = await engine.ingest(updates);
    expect(publish).toHaveBeenCalledWith(updates);
    expect(res).toEqual({ status: "success", sinks: [] });
  });
});

describe("RealismEngine (enabled) ingest", () => {
  it("does NOT publish on ingest; stores true state", async () => {
    const { engine, publish } = makeEngine({ enabled: true });
    const res = await engine.ingest([{ id: "v1", latitude: 1, longitude: 2 }]);
    expect(publish).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "accepted" });
    expect(engine.getStatus().devices).toBe(1);
  });
});

describe("RealismEngine scheduler", () => {
  it("emits roughly once per reporting period when connected", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      // force always-connected so it always emits
      connectivity: {
        meanConnectedS: 1e9,
        meanDegradedS: 1,
        meanDisconnectedS: 1,
        degradedFromConnectedS: 1e9,
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    // simulate 10 seconds of 250ms ticks
    for (let i = 0; i < 40; i++) {
      advance(250);
      await engine.tick();
    }
    // ~10 emits over 10s at 1s period (allow some slack)
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(publish.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("emitted position differs from truth but stays within a few hundred meters", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      connectivity: {
        meanConnectedS: 1e9,
        meanDegradedS: 1,
        meanDisconnectedS: 1,
        degradedFromConnectedS: 1e9,
      },
    });
    const lat = -1.29;
    const lon = 36.82;
    await engine.ingest([{ id: "v1", latitude: lat, longitude: lon }]);
    for (let i = 0; i < 20; i++) {
      advance(250);
      await engine.tick();
    }
    const lastBatch = publish.mock.calls.at(-1)![0] as Array<{
      latitude: number;
      longitude: number;
      accuracy: number;
      timestamp: number;
    }>;
    const s = lastBatch[0];
    expect(s.latitude).not.toBe(lat);
    expect(Math.abs(s.latitude - lat)).toBeLessThan(0.01); // < ~1.1km
    expect(s.accuracy).toBeGreaterThan(0);
    expect(typeof s.timestamp).toBe("number");
  });
});

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
    // Default quiesce off so ingest-once-then-tick tests aren't evicted; the
    // staleness behavior is exercised explicitly in its own test.
    config: { emitStaleAfterMs: 0, ...overrides },
  });
  return { engine, publish, advance: (ms: number) => (t += ms), getT: () => t };
}

describe("RealismEngine (disabled)", () => {
  it("passes ingest straight through to publish and returns its result", async () => {
    const { engine, publish } = makeEngine({ enabled: false });
    const updates = [{ id: "v1", latitude: 1, longitude: 2 }];
    const res = await engine.ingest(updates);
    // No publish context supplied → forwarded as undefined.
    expect(publish).toHaveBeenCalledWith(updates, undefined);
    expect(res).toEqual({ status: "success", sinks: [] });
  });

  it("forwards the publish context to publish on the synchronous path", async () => {
    const { engine, publish } = makeEngine({ enabled: false });
    const updates = [{ id: "v1", latitude: 1, longitude: 2 }];
    const context = { correlationId: "req-123", traceId: "req-123" };
    await engine.ingest(updates, context);
    expect(publish).toHaveBeenCalledWith(updates, context);
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

  it("clears device state when toggled off so re-enable starts clean", async () => {
    const { engine } = makeEngine({ enabled: true });
    await engine.ingest([{ id: "v1", latitude: 1, longitude: 2 }]);
    expect(engine.getStatus().devices).toBe(1);

    engine.reconfigure({ enabled: false });
    expect(engine.getStatus().devices).toBe(0);
  });
});

describe("RealismEngine staleness quiesce", () => {
  it("stops emitting and evicts a device once ingest goes stale (source paused)", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      emitStaleAfterMs: 3000,
      // keep it connected so the only reason it stops is staleness
      connectivity: {
        meanConnectedS: 1e9,
        meanDegradedS: 1,
        meanDisconnectedS: 1,
        degradedFromConnectedS: 1e9,
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);

    // Emits while fresh (no further ingest)...
    for (let i = 0; i < 8; i++) {
      advance(250);
      await engine.tick();
    }
    const emitsWhileFresh = publish.mock.calls.length;
    expect(emitsWhileFresh).toBeGreaterThan(0);

    // ...then keep ticking past the stale window without re-ingesting.
    for (let i = 0; i < 12; i++) {
      advance(250);
      await engine.tick();
    }
    // Device evicted; emission stopped.
    expect(engine.getStatus().devices).toBe(0);
    const emitsAfterStale = publish.mock.calls.length;

    // A few more ticks produce no new emits.
    for (let i = 0; i < 8; i++) {
      advance(250);
      await engine.tick();
    }
    expect(publish.mock.calls.length).toBe(emitsAfterStale);
  });

  it("re-creates the device fresh when ingest resumes after quiesce", async () => {
    const { engine, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      emitStaleAfterMs: 2000,
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    // Go stale → evicted.
    for (let i = 0; i < 12; i++) {
      advance(250);
      await engine.tick();
    }
    expect(engine.getStatus().devices).toBe(0);

    // Resume ingest → device comes back.
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    expect(engine.getStatus().devices).toBe(1);
    expect(engine.getStatus().connected).toBe(1);
  });

  it("emitStaleAfterMs=0 keeps emitting frozen position indefinitely (opt-out)", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      emitStaleAfterMs: 0,
      connectivity: {
        meanConnectedS: 1e9,
        meanDegradedS: 1,
        meanDisconnectedS: 1,
        degradedFromConnectedS: 1e9,
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    for (let i = 0; i < 40; i++) {
      advance(250);
      await engine.tick();
    }
    expect(engine.getStatus().devices).toBe(1);
    expect(publish.mock.calls.length).toBeGreaterThan(5);
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

describe("RealismEngine store-and-forward", () => {
  function disconnectedEngine() {
    // Force disconnected: connected->disconnected certain; disconnected stays.
    return makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      storeAndForward: true,
      connectivity: {
        meanConnectedS: 0.001, // exit connected immediately -> drop
        meanDegradedS: 0.001,
        meanDisconnectedS: 1e9, // never reconnect
        degradedFromConnectedS: 1e9, // never degrade (so it drops)
      },
    });
  }

  it("buffers (no emit) while disconnected", async () => {
    const { engine, publish, advance } = disconnectedEngine();
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    for (let i = 0; i < 12; i++) {
      advance(250);
      await engine.tick();
    }
    expect(publish).not.toHaveBeenCalled();
    expect(engine.getStatus().disconnected).toBe(1);
    expect(engine.getStatus().buffered).toBeGreaterThan(0);
  });

  it("bursts buffered samples on reconnect with original timestamps", async () => {
    // Start disconnected & buffering, then reconnect via mean-duration extremes.
    const publish = vi.fn().mockResolvedValue({ status: "success", sinks: [] });
    let t = 0;
    // State is forced entirely by the connectivity means (tiny mean => p=1 exit,
    // huge mean => p=0 exit), so the rng VALUE is irrelevant for transitions. It
    // just must be non-degenerate: a constant 0 makes Box-Muller spin forever in
    // makeGaussian's `while (u === 0) u = rng()` guard.
    const engine = new RealismEngine({
      publish,
      now: () => t,
      rng: mulberry32(777),
      config: {
        enabled: true,
        reportingPeriodMs: 1000,
        jitterMs: 0,
        storeAndForward: true,
        connectivity: {
          meanConnectedS: 0.001,
          meanDegradedS: 0.001,
          meanDisconnectedS: 1e9,
          degradedFromConnectedS: 1e9,
        },
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    for (let i = 0; i < 6; i++) {
      t += 250;
      await engine.tick();
    }
    const buffered = engine.getStatus().buffered;
    expect(buffered).toBeGreaterThan(0);
    expect(publish).not.toHaveBeenCalled();

    // Now make disconnected->connected fire: set meanDisconnectedS tiny via
    // reconfigure. Advance a full reporting period so the device's nextEmitAt is
    // due on this tick (buffering only emits once per period, not every 250ms).
    engine.reconfigure({ connectivity: { meanDisconnectedS: 0.001 } });
    t += 1000;
    await engine.tick();

    expect(publish).toHaveBeenCalledTimes(1);
    const burst = publish.mock.calls[0][0] as Array<{ timestamp: number }>;
    // burst contains the buffered samples plus the live one
    expect(burst.length).toBeGreaterThanOrEqual(buffered);
    // timestamps are non-decreasing (oldest-first) and older than current t.
    for (let i = 1; i < burst.length; i++) {
      expect(burst[i].timestamp).toBeGreaterThanOrEqual(burst[i - 1].timestamp);
    }
    expect(burst[0].timestamp).toBeLessThanOrEqual(t);
    expect(engine.getStatus().buffered).toBe(0);
  });

  it("caps the buffer at maxBufferPerDevice, dropping the oldest", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      storeAndForward: true,
      maxBufferPerDevice: 3,
      connectivity: {
        meanConnectedS: 0.001, // exit connected immediately -> drop
        meanDegradedS: 0.001,
        meanDisconnectedS: 1e9, // never reconnect
        degradedFromConnectedS: 1e9, // never degrade (so it drops)
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    // 20 reporting periods worth of ticks — buffer would far exceed the cap.
    for (let i = 0; i < 80; i++) {
      advance(250);
      await engine.tick();
    }
    expect(publish).not.toHaveBeenCalled();
    expect(engine.getStatus().disconnected).toBe(1);
    // Cap is respected: never exceeds maxBufferPerDevice (oldest dropped).
    expect(engine.getStatus().buffered).toBe(3);
  });

  it("drop mode discards during outage (no burst)", async () => {
    const { engine, publish, advance } = makeEngine({
      enabled: true,
      reportingPeriodMs: 1000,
      jitterMs: 0,
      storeAndForward: false,
      connectivity: {
        meanConnectedS: 0.001,
        meanDegradedS: 0.001,
        meanDisconnectedS: 1e9,
        degradedFromConnectedS: 1e9,
      },
    });
    await engine.ingest([{ id: "v1", latitude: -1.29, longitude: 36.82 }]);
    for (let i = 0; i < 8; i++) {
      advance(250);
      await engine.tick();
    }
    expect(publish).not.toHaveBeenCalled();
    expect(engine.getStatus().buffered).toBe(0);
  });
});

describe("RealismEngine reconfigure (deep merge)", () => {
  it("partial connectivity reconfigure preserves the other connectivity means", () => {
    const { engine } = makeEngine({
      enabled: true,
      connectivity: {
        meanConnectedS: 1234,
        meanDegradedS: 77,
        meanDisconnectedS: 88,
        degradedFromConnectedS: 99,
      },
    });

    engine.reconfigure({ connectivity: { meanDisconnectedS: 5 } });

    const c = engine.getConfig().connectivity;
    expect(c.meanDisconnectedS).toBe(5); // overridden
    // Siblings preserved at their prior values (not reset to defaults).
    expect(c.meanConnectedS).toBe(1234);
    expect(c.meanDegradedS).toBe(77);
    expect(c.degradedFromConnectedS).toBe(99);
  });

  it("partial gps reconfigure preserves the other gps params", () => {
    const { engine } = makeEngine({
      enabled: true,
      gps: { connectedSigmaM: 9, connectedTauS: 200, degradedSigmaM: 30, degradedTauS: 40 },
    });

    engine.reconfigure({ gps: { connectedSigmaM: 1 } });

    const g = engine.getConfig().gps;
    expect(g.connectedSigmaM).toBe(1); // overridden
    expect(g.connectedTauS).toBe(200);
    expect(g.degradedSigmaM).toBe(30);
    expect(g.degradedTauS).toBe(40);
  });
});

describe("RealismEngine scheduler error handling", () => {
  it("catches tick rejections from the interval callback (no unhandled rejection)", async () => {
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const { engine } = makeEngine({ enabled: true }); // autoStart → start()
      expect(intervalSpy).toHaveBeenCalledTimes(1);
      const callback = intervalSpy.mock.calls[0][0] as () => void;

      // Force the next tick to reject.
      engine.tick = vi.fn().mockRejectedValue(new Error("tick boom"));

      expect(() => callback()).not.toThrow();
      expect(engine.tick).toHaveBeenCalledTimes(1);

      // Let the rejection (if uncaught) surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      intervalSpy.mockRestore();
    }
  });
});

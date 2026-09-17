import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherManager, type FetchLike } from "../../modules/weather/WeatherManager";

vi.mock("../../utils/logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: log, createLogger: () => log };
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function openMeteoBody(current: Record<string, unknown>) {
  return { current };
}

const BASE_SETTINGS = {
  enabled: true,
  pollIntervalMs: 60_000,
  lat: -1.29,
  lon: 36.82,
  fetchTimeoutMs: 5000,
};

describe("WeatherManager", () => {
  let manager: WeatherManager;

  afterEach(() => {
    manager?.stop();
    vi.useRealTimers();
  });

  // ─── Offline safety ─────────────────────────────────────────────────

  it("makes no fetch calls when disabled, even if start() is called", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    manager = new WeatherManager({ ...BASE_SETTINGS, enabled: false }, fetchImpl);
    manager.start();
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes no fetch calls when start() is never called", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl);
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("defaults to clear/factor 1 before any poll", () => {
    manager = new WeatherManager(BASE_SETTINGS, vi.fn<FetchLike>());
    expect(manager.state()).toEqual({
      condition: "clear",
      speedFactor: 1,
      source: "live",
      observedAt: null,
    });
    expect(manager.factor).toBe(1);
  });

  // ─── Polling ─────────────────────────────────────────────────────────

  it("skips a poll while the previous one is still in flight (no stale overwrite)", async () => {
    let resolveSlow!: (v: ReturnType<typeof jsonResponse>) => void;
    const slow = new Promise<ReturnType<typeof jsonResponse>>((r) => (resolveSlow = r));
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(jsonResponse(openMeteoBody({ weather_code: 0 })));
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl);

    // @ts-expect-error — private, invoked directly.
    const first = manager.poll();
    // @ts-expect-error — private, invoked directly.
    await manager.poll();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveSlow(jsonResponse(openMeteoBody({ rain: 5, weather_code: 63 })));
    await first;
    expect(manager.state().condition).toBe("rain");

    // Once settled, the next poll runs again.
    // @ts-expect-error — private, invoked directly.
    await manager.poll();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("polls Open-Meteo for the given lat/lon and maps the reading to a factor", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse(openMeteoBody({ rain: 5, weather_code: 63 })));
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl, () => 12345);
    // @ts-expect-error — private, invoked directly for a deterministic single poll.
    await manager.poll();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(url).toContain("latitude=-1.29");
    expect(url).toContain("longitude=36.82");
    expect(url).toContain(
      "current=precipitation,rain,snowfall,weather_code,visibility,wind_speed_10m"
    );

    expect(manager.state()).toEqual({
      condition: "rain",
      speedFactor: expect.closeTo(0.85, 5),
      source: "live",
      observedAt: 12345,
    });
  });

  it("emits weather:changed only when the mapped condition/factor actually changes", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse(openMeteoBody({ rain: 5, weather_code: 63 })))
      .mockResolvedValueOnce(jsonResponse(openMeteoBody({ rain: 5, weather_code: 63 }))) // same condition
      .mockResolvedValueOnce(jsonResponse(openMeteoBody({}))); // back to clear
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl);
    const changes: string[] = [];
    manager.on("weather:changed", (state) => changes.push(state.condition));

    // @ts-expect-error — private, invoked directly to avoid real timers.
    await manager.poll();
    // @ts-expect-error
    await manager.poll();
    // @ts-expect-error
    await manager.poll();

    expect(changes).toEqual(["rain", "clear"]);
  });

  it("keeps the last value, logs, and does not throw on a fetch failure", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error("network down"));
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl);
    // @ts-expect-error — private
    await expect(manager.poll()).resolves.toBeUndefined();
    expect(manager.state().condition).toBe("clear");
    expect(manager.state().speedFactor).toBe(1);
  });

  it("keeps the last value on a non-2xx response", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 503));
    manager = new WeatherManager(BASE_SETTINGS, fetchImpl);
    // @ts-expect-error — private
    await manager.poll();
    expect(manager.state().speedFactor).toBe(1);
  });

  it("aborts the fetch after the configured timeout", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<FetchLike>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init?.signal;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    manager = new WeatherManager({ ...BASE_SETTINGS, fetchTimeoutMs: 1000 }, fetchImpl);
    // @ts-expect-error — private
    const pollPromise = manager.poll();
    await vi.advanceTimersByTimeAsync(1000);
    await pollPromise;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("start() polls once immediately and again on the interval; stop() halts it", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(openMeteoBody({})));
    manager = new WeatherManager({ ...BASE_SETTINGS, pollIntervalMs: 1000 }, fetchImpl);
    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    manager.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("start() is idempotent (no duplicate intervals)", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(openMeteoBody({})));
    manager = new WeatherManager({ ...BASE_SETTINGS, pollIntervalMs: 1000 }, fetchImpl);
    manager.start();
    manager.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one immediate + one interval tick, not doubled
  });

  // ─── Manual override ────────────────────────────────────────────────

  describe("override", () => {
    beforeEach(() => {
      manager = new WeatherManager(BASE_SETTINGS, vi.fn<FetchLike>());
    });

    it("sets a factor override directly", () => {
      const result = manager.setOverride({ factor: 0.4 });
      expect(result.speedFactor).toBe(0.4);
      expect(result.source).toBe("override");
      expect(manager.factor).toBe(0.4);
      expect(manager.hasOverride()).toBe(true);
    });

    it("sets an override by condition name, using its canonical factor", () => {
      const result = manager.setOverride({ condition: "snow" });
      expect(result.condition).toBe("snow");
      expect(result.speedFactor).toBeGreaterThan(0);
      expect(result.speedFactor).toBeLessThan(1);
    });

    it("clamps an out-of-range factor override to (0, 1]", () => {
      expect(manager.setOverride({ factor: 5 }).speedFactor).toBe(1);
      expect(manager.setOverride({ factor: -1 }).speedFactor).toBeGreaterThan(0);
    });

    it("clearOverride() reverts to the live reading and is idempotent", () => {
      manager.setOverride({ factor: 0.3 });
      const cleared = manager.clearOverride();
      expect(cleared.source).toBe("live");
      expect(manager.hasOverride()).toBe(false);
      // Calling again is a no-op, not an error.
      expect(manager.clearOverride()).toEqual(cleared);
    });

    it("emits weather:changed on setOverride and on a real clearOverride", () => {
      const changes: string[] = [];
      manager.on("weather:changed", (state) => changes.push(state.source));
      manager.setOverride({ factor: 0.5 });
      manager.clearOverride();
      manager.clearOverride(); // no-op, no extra event
      expect(changes).toEqual(["override", "live"]);
    });

    it("a poll while overridden does not change the displayed state, but refreshes the underlying live value", async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValue(jsonResponse(openMeteoBody({ rain: 5, weather_code: 63 })));
      const m = new WeatherManager(BASE_SETTINGS, fetchImpl);
      m.setOverride({ factor: 0.2 });
      // @ts-expect-error — private
      await m.poll();
      expect(m.state().speedFactor).toBe(0.2); // override still wins
      m.clearOverride();
      expect(m.state().condition).toBe("rain"); // live reading was kept fresh underneath
    });
  });
});

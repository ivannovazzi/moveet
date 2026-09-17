import { describe, it, expect } from "vitest";
import {
  weatherSpeedFactor,
  CONDITION_SPEED_FACTORS,
  type WeatherObservation,
} from "../../modules/weather/conditions";

/** A clean baseline observation; tests override only the fields they care about. */
function obs(overrides: Partial<WeatherObservation> = {}): WeatherObservation {
  return {
    precipitationMmH: 0,
    rainMmH: 0,
    snowfallCmH: 0,
    weatherCode: 0,
    visibilityM: 20_000,
    windSpeedKmh: 10,
    ...overrides,
  };
}

describe("weatherSpeedFactor", () => {
  it("reports clear with factor 1 for a calm, dry, clear-visibility reading", () => {
    expect(weatherSpeedFactor(obs())).toEqual({ condition: "clear", factor: 1 });
  });

  // ─── Rain ────────────────────────────────────────────────────────

  it("maps light rain (<= 2.5 mm/h) to light_rain ~0.93", () => {
    const result = weatherSpeedFactor(obs({ rainMmH: 1, weatherCode: 61 }));
    expect(result.condition).toBe("light_rain");
    expect(result.factor).toBeCloseTo(0.93, 5);
  });

  it("maps heavier rain (> 2.5 mm/h) to rain ~0.85", () => {
    const result = weatherSpeedFactor(obs({ rainMmH: 5, weatherCode: 63 }));
    expect(result.condition).toBe("rain");
    expect(result.factor).toBeCloseTo(0.85, 5);
  });

  it("uses the weather code's heavy-rain bucket even when rainMmH is small", () => {
    const result = weatherSpeedFactor(obs({ rainMmH: 0.5, weatherCode: 95 }));
    expect(result.condition).toBe("rain");
  });

  it("falls back to precipitationMmH when rainMmH is 0 but precipitation is reported", () => {
    const result = weatherSpeedFactor(obs({ precipitationMmH: 1, weatherCode: 51 }));
    expect(result.condition).toBe("light_rain");
  });

  // ─── Snow ────────────────────────────────────────────────────────

  it("maps light snowfall to snow ~0.85", () => {
    const result = weatherSpeedFactor(obs({ snowfallCmH: 0.2, weatherCode: 71 }));
    expect(result.condition).toBe("snow");
    expect(result.factor).toBeCloseTo(0.85, 5);
  });

  it("maps moderate snowfall to snow ~0.75", () => {
    const result = weatherSpeedFactor(obs({ snowfallCmH: 1, weatherCode: 73 }));
    expect(result.condition).toBe("snow");
    expect(result.factor).toBeCloseTo(0.75, 5);
  });

  it("maps heavy snowfall to snow ~0.6", () => {
    const result = weatherSpeedFactor(obs({ snowfallCmH: 5, weatherCode: 75 }));
    expect(result.condition).toBe("snow");
    expect(result.factor).toBeCloseTo(0.6, 5);
  });

  it("takes priority over rain when both snowfall and rain are reported", () => {
    const result = weatherSpeedFactor(obs({ snowfallCmH: 1, rainMmH: 5, weatherCode: 73 }));
    expect(result.condition).toBe("snow");
  });

  // ─── Ice / freezing rain ────────────────────────────────────────────

  it("maps freezing-rain codes to ice ~0.6, taking priority over everything else", () => {
    const result = weatherSpeedFactor(obs({ weatherCode: 66, rainMmH: 1, snowfallCmH: 1 }));
    expect(result.condition).toBe("ice");
    expect(result.factor).toBeCloseTo(0.6, 5);
  });

  // ─── Fog ────────────────────────────────────────────────────────

  it("maps low visibility (< 1000 m) to fog ~0.9", () => {
    const result = weatherSpeedFactor(obs({ visibilityM: 400 }));
    expect(result.condition).toBe("fog");
    expect(result.factor).toBeCloseTo(0.9, 5);
  });

  it("maps a fog weather code to fog even with normal visibility (missing/stale reading)", () => {
    const result = weatherSpeedFactor(obs({ weatherCode: 45, visibilityM: 20_000 }));
    expect(result.condition).toBe("fog");
  });

  it("treats a null visibility as unknown rather than foggy", () => {
    const result = weatherSpeedFactor(obs({ visibilityM: null, weatherCode: 0 }));
    expect(result.condition).toBe("clear");
  });

  // ─── Wind ────────────────────────────────────────────────────────

  it("reports wind and applies its factor when nothing else fires but wind is strong", () => {
    const result = weatherSpeedFactor(obs({ windSpeedKmh: 80 }));
    expect(result.condition).toBe("wind");
    expect(result.factor).toBeCloseTo(0.97, 5);
  });

  it("stacks the wind factor on top of rain without changing the reported condition", () => {
    const calm = weatherSpeedFactor(obs({ rainMmH: 5, weatherCode: 63, windSpeedKmh: 10 }));
    const windy = weatherSpeedFactor(obs({ rainMmH: 5, weatherCode: 63, windSpeedKmh: 80 }));
    expect(windy.condition).toBe("rain");
    expect(windy.factor).toBeCloseTo(calm.factor * 0.97, 5);
  });

  it("leaves normal wind (<= 60 km/h) with no extra effect", () => {
    const result = weatherSpeedFactor(obs({ windSpeedKmh: 40 }));
    expect(result.condition).toBe("clear");
    expect(result.factor).toBe(1);
  });

  // ─── Output invariants ──────────────────────────────────────────────

  it("never returns a factor outside (0, 1]", () => {
    const observations: WeatherObservation[] = [
      obs({ snowfallCmH: 50, windSpeedKmh: 200 }),
      obs({ weatherCode: 66, windSpeedKmh: 200 }),
      obs(),
    ];
    for (const o of observations) {
      const { factor } = weatherSpeedFactor(o);
      expect(factor).toBeGreaterThan(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });
});

describe("CONDITION_SPEED_FACTORS", () => {
  it("has an entry for every WeatherCondition and each is in (0, 1]", () => {
    const conditions = ["clear", "light_rain", "rain", "snow", "ice", "fog", "wind"] as const;
    for (const c of conditions) {
      expect(CONDITION_SPEED_FACTORS[c]).toBeGreaterThan(0);
      expect(CONDITION_SPEED_FACTORS[c]).toBeLessThanOrEqual(1);
    }
    expect(CONDITION_SPEED_FACTORS.clear).toBe(1);
  });
});

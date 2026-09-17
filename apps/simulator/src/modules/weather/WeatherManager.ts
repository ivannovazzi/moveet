/**
 * Polls Open-Meteo's free, keyless current-weather endpoint for the network's
 * location on an interval and turns the reading into a global routing/
 * movement speed factor (fleetsim-all-1ajn.5). Also holds the manual override
 * used by scenarios/tests to pin a condition or factor without a live poll.
 *
 * Config-gated and offline-safe: `settings.enabled` (from `WEATHER_ENABLED`,
 * default false) must be true for {@link start} to ever call `fetch` — with it
 * false (the default, and always in tests unless a test explicitly enables
 * it), this class makes zero network calls, matching the same pattern
 * `SPEED_PROFILES_ENABLED` and `FAULTS_ENABLED` use elsewhere. `fetch` is
 * injected (constructor param, defaults to the global) so tests never hit the
 * network even if they DO enable polling.
 *
 * On a fetch failure (network error, timeout, non-2xx, bad JSON) the last
 * known reading is kept, a warning is logged, and nothing throws — a flaky
 * weather API must never take the simulator down.
 */

import { EventEmitter } from "events";
import type { WeatherCondition, WeatherDTO } from "@moveet/shared-types";
import { weatherSpeedFactor, CONDITION_SPEED_FACTORS, type WeatherObservation } from "./conditions";
import { clampWeatherFactor } from "../pathfinding/cost";
import { createLogger } from "../../utils/logger";

const log = createLogger("Weather");

/** Matches the global `fetch` signature closely enough to inject a fake in tests. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface WeatherManagerSettings {
  /** Mirrors `WEATHER_ENABLED`. {@link start} is a no-op unless this is true. */
  enabled: boolean;
  /** Mirrors `WEATHER_POLL_INTERVAL_MS`. */
  pollIntervalMs: number;
  /** Network bbox centre latitude (or `WEATHER_LAT` override). */
  lat: number;
  /** Network bbox centre longitude (or `WEATHER_LON` override). */
  lon: number;
  /** Mirrors `WEATHER_FETCH_TIMEOUT_MS`. */
  fetchTimeoutMs: number;
}

interface OpenMeteoCurrent {
  precipitation?: number;
  rain?: number;
  snowfall?: number;
  weather_code?: number;
  visibility?: number;
  wind_speed_10m?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

const DEFAULT_STATE: WeatherDTO = {
  condition: "clear",
  speedFactor: 1,
  source: "live",
  observedAt: null,
};

/** Override input: at least one of `condition`/`factor` (validated by the route schema before this is called). */
export interface WeatherOverrideInput {
  condition?: WeatherCondition;
  factor?: number;
}

export class WeatherManager extends EventEmitter {
  /** Last live poll result (or the default before the first poll / while disabled). */
  private live: WeatherDTO = DEFAULT_STATE;
  /** Active manual override, or null when routing/movement should use the live reading. */
  private overrideState: WeatherDTO | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * True while a poll's fetch is outstanding. A slow response (up to
   * `fetchTimeoutMs`, which may exceed the poll interval) must not overlap a
   * newer poll: whichever resolved last would win, possibly the older reading.
   */
  private polling = false;

  constructor(
    private readonly settings: WeatherManagerSettings,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now
  ) {
    super();
  }

  /** The state routing/movement should use right now: the override if set, else the live reading. */
  state(): WeatherDTO {
    return this.overrideState ?? this.live;
  }

  /** Convenience accessor for the effective speed factor — see {@link state}. */
  get factor(): number {
    return this.state().speedFactor;
  }

  /** Starts the poll interval. No-op when already started or `settings.enabled` is false (no network calls). */
  start(): void {
    if (!this.settings.enabled || this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.settings.pollIntervalMs);
    this.timer.unref?.();
  }

  /** Stops the poll interval. Safe to call when not started. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Sets a manual override — a fixed condition and/or factor that routing and
   * movement use until {@link clearOverride}. Passing only `condition` uses
   * that condition's canonical factor ({@link CONDITION_SPEED_FACTORS}); a
   * `factor` overrides that (both may be given to report a custom condition
   * label alongside a specific factor). Emits `weather:changed`.
   */
  setOverride(input: WeatherOverrideInput): WeatherDTO {
    const current = this.state();
    const speedFactor =
      input.factor !== undefined
        ? clampWeatherFactor(input.factor)
        : input.condition !== undefined
          ? CONDITION_SPEED_FACTORS[input.condition]
          : current.speedFactor;
    const condition = input.condition ?? current.condition;
    this.overrideState = {
      condition,
      speedFactor,
      source: "override",
      observedAt: current.observedAt,
    };
    this.emit("weather:changed", this.state());
    return this.state();
  }

  /** Clears an active override, reverting to the live reading. Emits `weather:changed` when it changes anything. */
  clearOverride(): WeatherDTO {
    if (!this.overrideState) return this.state();
    this.overrideState = null;
    this.emit("weather:changed", this.state());
    return this.state();
  }

  /** Whether a manual override is currently active. */
  hasOverride(): boolean {
    return this.overrideState !== null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    let obs: WeatherObservation;
    try {
      obs = await this.fetchObservation();
    } catch (err) {
      log.warn(`Weather poll failed, keeping last value: ${(err as Error).message}`);
      return;
    } finally {
      this.polling = false;
    }
    const { condition, factor } = weatherSpeedFactor(obs);
    const before = this.state();
    this.live = { condition, speedFactor: factor, source: "live", observedAt: this.now() };
    // An active override keeps the DISPLAYED state unchanged (it wins), but the
    // live reading underneath is still refreshed so `clearOverride` reverts to
    // something current rather than a stale pre-override value.
    if (this.overrideState) return;
    const after = this.state();
    if (after.condition !== before.condition || after.speedFactor !== before.speedFactor) {
      this.emit("weather:changed", after);
    }
  }

  private async fetchObservation(): Promise<WeatherObservation> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${this.settings.lat}&longitude=${this.settings.lon}` +
      `&current=precipitation,rain,snowfall,weather_code,visibility,wind_speed_10m`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.fetchTimeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`);
      const body = (await res.json()) as OpenMeteoResponse;
      const c = body.current ?? {};
      return {
        precipitationMmH: c.precipitation ?? 0,
        rainMmH: c.rain ?? 0,
        snowfallCmH: c.snowfall ?? 0,
        weatherCode: c.weather_code ?? 0,
        visibilityM: c.visibility ?? null,
        windSpeedKmh: c.wind_speed_10m ?? 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

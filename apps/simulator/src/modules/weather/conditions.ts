/**
 * Pure weather condition -> speed factor mapping (fleetsim-all-1ajn.5), HCM/
 * FHWA-ish ranges from the issue: clear 1.0, light rain ~0.93, moderate/heavy
 * rain ~0.85, snow 0.6-0.85 by intensity, freezing rain/ice ~0.6, fog (low
 * visibility or WMO fog codes) ~0.9, strong wind a small extra effect.
 *
 * Deliberately has ZERO knowledge of Open-Meteo, fetch, config or the
 * network — {@link WeatherManager} owns all of that. Kept pure so the mapping
 * is unit-testable without a live network call and reusable from a manual
 * override (condition name -> canonical factor, see {@link CONDITION_SPEED_FACTORS}).
 *
 * Night factor: intentionally NOT implemented. A sun-position/daylight term
 * would need latitude/longitude/date astronomy (or a sunrise/sunset table) to
 * do correctly, which is a meaningfully bigger surface than "trivial" — see
 * fleetsim-all-1ajn.5's acceptance note. Skipped; revisit as a follow-up issue
 * if night driving conditions turn out to matter for ETA accuracy.
 */

import type { WeatherCondition } from "@moveet/shared-types";
import { clampWeatherFactor } from "../pathfinding/cost";

/** One Open-Meteo `current` reading, already unwrapped from the HTTP response. */
export interface WeatherObservation {
  /** Total precipitation, mm over the last hour. */
  precipitationMmH: number;
  /** Rain component, mm over the last hour. */
  rainMmH: number;
  /** Snowfall, cm over the last hour (Open-Meteo's default unit). */
  snowfallCmH: number;
  /** WMO weather interpretation code (https://open-meteo.com/en/docs, "WMO Weather interpretation codes"). */
  weatherCode: number;
  /** Visibility in metres, or null when the field is unavailable. */
  visibilityM: number | null;
  /** 10 m wind speed, km/h. */
  windSpeedKmh: number;
}

// ─── Speed factors (see the module header for the source ranges) ────────

const CLEAR_FACTOR = 1.0;
const LIGHT_RAIN_FACTOR = 0.93;
const RAIN_FACTOR = 0.85;
const LIGHT_SNOW_FACTOR = 0.85;
const MODERATE_SNOW_FACTOR = 0.75;
const HEAVY_SNOW_FACTOR = 0.6;
const ICE_FACTOR = 0.6;
const FOG_FACTOR = 0.9;
/** Extra multiplier stacked on top of any other condition when wind is strong. */
const STRONG_WIND_FACTOR = 0.97;

/** Canonical factor per named condition — used by a manual override that names a condition without a factor. */
export const CONDITION_SPEED_FACTORS: Readonly<Record<WeatherCondition, number>> = Object.freeze({
  clear: CLEAR_FACTOR,
  light_rain: LIGHT_RAIN_FACTOR,
  rain: RAIN_FACTOR,
  snow: MODERATE_SNOW_FACTOR, // representative mid-intensity value; live readings pick light/moderate/heavy themselves
  ice: ICE_FACTOR,
  fog: FOG_FACTOR,
  wind: STRONG_WIND_FACTOR,
});

// ─── WMO weather_code buckets (https://open-meteo.com/en/docs) ──────────

/** Fog, depositing rime fog. */
const FOG_CODES = new Set([45, 48]);
/** Freezing drizzle/rain — the "ice" condition. */
const FREEZING_RAIN_CODES = new Set([66, 67]);
/** Any snow code (slight/moderate/heavy continuous, grains, slight/heavy showers). */
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const HEAVY_SNOW_CODES = new Set([75, 86]);
const MODERATE_SNOW_CODES = new Set([73]);
/** Any rain/drizzle/thunderstorm code. */
const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
const HEAVY_RAIN_CODES = new Set([55, 65, 82, 95, 96, 99]);

// ─── Intensity thresholds ─────────────────────────────────────────────

const FOG_VISIBILITY_M = 1000;
const LIGHT_RAIN_MM_H = 2.5;
const LIGHT_SNOW_CM_H = 0.5;
const MODERATE_SNOW_CM_H = 2.5;
const STRONG_WIND_KMH = 60;

export interface WeatherAssessment {
  condition: WeatherCondition;
  /** Clamped to `(0, 1]` — see `pathfinding/cost.ts` clampWeatherFactor. */
  factor: number;
}

/**
 * Maps one live observation to a `{ condition, factor }` pair. Precipitation
 * type takes priority in the order ice > snow > rain > fog (an observation
 * with more than one signal reports whichever is worse and uses ITS factor);
 * strong wind then stacks a small extra multiplier on top regardless of what
 * else applies, and becomes the reported condition only when nothing else
 * already fired.
 */
export function weatherSpeedFactor(obs: WeatherObservation): WeatherAssessment {
  let condition: WeatherCondition = "clear";
  let factor = CLEAR_FACTOR;

  if (FREEZING_RAIN_CODES.has(obs.weatherCode)) {
    condition = "ice";
    factor = ICE_FACTOR;
  } else if (obs.snowfallCmH > 0 || SNOW_CODES.has(obs.weatherCode)) {
    condition = "snow";
    if (obs.snowfallCmH > MODERATE_SNOW_CM_H || HEAVY_SNOW_CODES.has(obs.weatherCode)) {
      factor = HEAVY_SNOW_FACTOR;
    } else if (obs.snowfallCmH > LIGHT_SNOW_CM_H || MODERATE_SNOW_CODES.has(obs.weatherCode)) {
      factor = MODERATE_SNOW_FACTOR;
    } else {
      factor = LIGHT_SNOW_FACTOR;
    }
  } else if (obs.rainMmH > 0 || obs.precipitationMmH > 0 || RAIN_CODES.has(obs.weatherCode)) {
    const heavy = obs.rainMmH > LIGHT_RAIN_MM_H || HEAVY_RAIN_CODES.has(obs.weatherCode);
    condition = heavy ? "rain" : "light_rain";
    factor = heavy ? RAIN_FACTOR : LIGHT_RAIN_FACTOR;
  } else if (
    (obs.visibilityM !== null && obs.visibilityM < FOG_VISIBILITY_M) ||
    FOG_CODES.has(obs.weatherCode)
  ) {
    condition = "fog";
    factor = FOG_FACTOR;
  }

  if (obs.windSpeedKmh > STRONG_WIND_KMH) {
    factor *= STRONG_WIND_FACTOR;
    if (condition === "clear") condition = "wind";
  }

  return { condition, factor: clampWeatherFactor(factor) };
}

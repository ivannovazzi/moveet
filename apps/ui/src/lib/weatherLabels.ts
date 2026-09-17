import type { WeatherCondition } from "@/types";

/**
 * Human labels for the simulator's weather conditions.
 *
 * The wire values are snake_case enum members (`light_rain`), which is right
 * for a protocol and wrong for a tooltip an operator reads at a glance.
 */
export const WEATHER_CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: "Clear",
  light_rain: "Light rain",
  rain: "Rain",
  snow: "Snow",
  ice: "Ice",
  fog: "Fog",
  wind: "Wind",
};

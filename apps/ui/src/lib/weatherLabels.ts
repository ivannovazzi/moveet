import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  Snowflake,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react";
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

/**
 * The icon each condition draws in the run-health lamp row.
 *
 * The lamp's tone already says whether weather is costing the fleet speed, but
 * tone is colour, and colour alone is not a signal. Drawing the condition means
 * rain and snow are distinguishable from each other and from clear weather
 * without reading the tooltip or seeing the amber.
 */
export const WEATHER_CONDITION_ICON: Record<WeatherCondition, LucideIcon> = {
  clear: Sun,
  light_rain: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  ice: Snowflake,
  fog: CloudFog,
  wind: Wind,
};

/** Stand-in until the first weather read lands, when there is no condition yet. */
export const WEATHER_UNKNOWN_ICON: LucideIcon = Cloud;

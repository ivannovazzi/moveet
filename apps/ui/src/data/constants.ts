import type { StartOptions } from "@/types";

/** Default start options for the simulation */
export const DEFAULT_START_OPTIONS: StartOptions = {
  minSpeed: 10,
  maxSpeed: 50,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 30,
  updateInterval: 10000,
  speedVariation: 0.1,
  heatZoneSpeedFactor: 0.5,
};

import type { VehicleProfile, VehicleType } from "../types";

export const VEHICLE_PROFILES: Record<VehicleType, VehicleProfile> = {
  car: {
    type: "car",
    minSpeed: 20,
    maxSpeed: 60,
    acceleration: 5,
    deceleration: 7,
    restrictedHighways: [],
    ignoreHeatZones: false,
    size: "medium",
  },
  truck: {
    type: "truck",
    minSpeed: 15,
    maxSpeed: 45,
    acceleration: 3,
    deceleration: 5,
    restrictedHighways: ["residential"],
    ignoreHeatZones: false,
    size: "large",
  },
  motorcycle: {
    type: "motorcycle",
    minSpeed: 25,
    maxSpeed: 70,
    acceleration: 8,
    deceleration: 9,
    restrictedHighways: [],
    ignoreHeatZones: false,
    size: "small",
  },
  ambulance: {
    type: "ambulance",
    minSpeed: 30,
    maxSpeed: 80,
    acceleration: 7,
    deceleration: 10,
    restrictedHighways: [],
    ignoreHeatZones: true,
    size: "medium",
  },
  bus: {
    type: "bus",
    minSpeed: 15,
    maxSpeed: 40,
    acceleration: 2,
    deceleration: 4,
    restrictedHighways: ["residential"],
    ignoreHeatZones: false,
    size: "large",
  },
};

export const FOLLOWING_DISTANCE_BY_SIZE: Record<string, number> = {
  small: 0.015,  // 15 meters in km
  medium: 0.02,  // 20 meters in km
  large: 0.03,   // 30 meters in km
};

export function getProfile(type: VehicleType): VehicleProfile {
  return VEHICLE_PROFILES[type];
}

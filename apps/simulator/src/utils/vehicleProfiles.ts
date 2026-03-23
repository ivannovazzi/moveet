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
  small: 0.015, // 15 meters in km
  medium: 0.02, // 20 meters in km
  large: 0.03, // 30 meters in km
};

/**
 * Default vehicle type distribution (percentages, must sum to 100).
 * Used when no explicit vehicleTypes map is provided (i.e. non-scenario mode).
 */
export const DEFAULT_VEHICLE_TYPE_WEIGHTS: Record<VehicleType, number> = {
  car: 60,
  truck: 15,
  bus: 10,
  motorcycle: 12,
  ambulance: 3,
};

/**
 * Picks a random vehicle type based on the default weight distribution.
 */
export function pickRandomType(): VehicleType {
  const entries = Object.entries(DEFAULT_VEHICLE_TYPE_WEIGHTS) as [VehicleType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return entries[0][0];
}

/**
 * Converts the percentage-based weights into absolute counts for a given total.
 * Guarantees the sum equals `total` by assigning remainders to the largest type.
 */
export function distributeByWeight(
  total: number,
  weights: Record<VehicleType, number> = DEFAULT_VEHICLE_TYPE_WEIGHTS
): Partial<Record<VehicleType, number>> {
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
  const result: Partial<Record<VehicleType, number>> = {};
  let assigned = 0;

  const entries = Object.entries(weights) as [VehicleType, number][];
  // Sort descending by weight so the largest bucket absorbs rounding remainder
  entries.sort((a, b) => b[1] - a[1]);

  for (let i = 0; i < entries.length; i++) {
    const [type, weight] = entries[i];
    if (i === 0) continue; // skip largest, assign remainder later
    const count = Math.round((weight / weightSum) * total);
    if (count > 0) {
      result[type] = count;
      assigned += count;
    }
  }

  // Largest type gets the remainder to guarantee exact total
  const remaining = total - assigned;
  if (remaining > 0) {
    result[entries[0][0]] = remaining;
  }

  return result;
}

export function getProfile(type: VehicleType): VehicleProfile {
  return VEHICLE_PROFILES[type];
}

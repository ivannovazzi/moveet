export interface TimeRange {
  start: number; // hour (0-23, inclusive)
  end: number; // hour (0-23, exclusive)
  demandMultiplier: number;
  affectedHighways: string[]; // HighwayType values; empty = all roads
}

export interface TrafficProfile {
  name: string;
  timeRanges: TimeRange[];
}

export const DEFAULT_TRAFFIC_PROFILE: TrafficProfile = {
  name: "default",
  timeRanges: [
    {
      start: 7,
      end: 9,
      demandMultiplier: 2.0,
      affectedHighways: ["trunk", "primary"],
    },
    {
      start: 17,
      end: 19,
      demandMultiplier: 2.5,
      affectedHighways: ["trunk", "primary"],
    },
    {
      start: 22,
      end: 24,
      demandMultiplier: 0.3,
      affectedHighways: [],
    },
    {
      start: 0,
      end: 5,
      demandMultiplier: 0.3,
      affectedHighways: [],
    },
  ],
};

/** Returns the demand multiplier for the given hour and highway type. */
export function getDemandMultiplier(
  profile: TrafficProfile,
  hour: number,
  highway: string
): number {
  for (const range of profile.timeRanges) {
    // Handle midnight-crossing ranges (start > end)
    const inRange =
      range.start <= range.end
        ? hour >= range.start && hour < range.end
        : hour >= range.start || hour < range.end;
    if (!inRange) continue;
    if (range.affectedHighways.length === 0 || range.affectedHighways.includes(highway)) {
      return range.demandMultiplier;
    }
  }
  return 1.0; // default: no adjustment
}

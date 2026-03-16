import type { SimulationClock } from "./SimulationClock";
import {
  getDemandMultiplier,
  DEFAULT_TRAFFIC_PROFILE,
  type TrafficProfile,
} from "../utils/trafficProfiles";
import type { HighwayType } from "../types";

export class TrafficManager {
  private edgeOccupancy: Map<string, number> = new Map();
  private static readonly CAPACITY_PER_KM = 20;
  private profile: TrafficProfile = { ...DEFAULT_TRAFFIC_PROFILE };

  constructor(private clock?: SimulationClock) {}

  enter(edgeId: string): void {
    this.edgeOccupancy.set(edgeId, (this.edgeOccupancy.get(edgeId) ?? 0) + 1);
  }

  leave(edgeId: string): void {
    const count = (this.edgeOccupancy.get(edgeId) ?? 1) - 1;
    if (count <= 0) this.edgeOccupancy.delete(edgeId);
    else this.edgeOccupancy.set(edgeId, count);
  }

  /**
   * Returns a speed multiplier (0.2 to 1.0) based on edge congestion and time-of-day demand.
   */
  getCongestionFactor(edgeId: string, edgeDistanceKm: number, highway: HighwayType = "primary"): number {
    const count = this.edgeOccupancy.get(edgeId) ?? 0;
    const capacity = Math.max(1, edgeDistanceKm * TrafficManager.CAPACITY_PER_KM);
    const hour = this.clock?.getHour() ?? new Date().getHours();
    const demand = getDemandMultiplier(this.profile, hour, highway);
    const effectiveOccupancy = count * demand;
    const occupancyRatio = effectiveOccupancy / capacity;
    return Math.max(0.2, 1 / (1 + occupancyRatio * occupancyRatio));
  }

  getProfile(): TrafficProfile {
    return { ...this.profile, timeRanges: [...this.profile.timeRanges] };
  }

  setProfile(profile: TrafficProfile): void {
    this.profile = profile;
  }
}

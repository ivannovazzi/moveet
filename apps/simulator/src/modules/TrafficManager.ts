import type { SimulationClock } from "./SimulationClock";
import {
  getDemandMultiplier,
  DEFAULT_TRAFFIC_PROFILE,
  type TrafficProfile,
} from "../utils/trafficProfiles";
import type { Edge, HighwayType } from "../types";

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
  getCongestionFactor(
    edgeId: string,
    edgeDistanceKm: number,
    highway: HighwayType = "primary"
  ): number {
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

  /**
   * Returns a snapshot of all edges with congestion data.
   * congestionFactor: 1.0 = free flow, 0.2 = completely jammed.
   */
  getTrafficSnapshot(
    getEdge: (id: string) => Edge | undefined
  ): Array<{
    edgeId: string;
    congestion: number;
    coordinates: [number, number][];
    highway: string;
  }> {
    const result: Array<{
      edgeId: string;
      congestion: number;
      coordinates: [number, number][];
      highway: string;
    }> = [];
    for (const [edgeId, count] of this.edgeOccupancy) {
      if (count <= 0) continue;
      const edge = getEdge(edgeId);
      if (!edge) continue;
      const congestion = this.getCongestionFactor(
        edgeId,
        edge.distance,
        edge.highway
      );
      result.push({
        edgeId,
        congestion,
        coordinates: [
          [edge.start.coordinates[0], edge.start.coordinates[1]],
          [edge.end.coordinates[0], edge.end.coordinates[1]],
        ],
        highway: edge.highway,
      });
    }
    return result;
  }
}

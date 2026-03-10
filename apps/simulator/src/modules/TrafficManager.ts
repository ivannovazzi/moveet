export class TrafficManager {
  // edge ID -> count of vehicles currently on that edge
  private edgeOccupancy: Map<string, number> = new Map();
  // Capacity estimate: 1 vehicle per 50m of road
  private static readonly CAPACITY_PER_KM = 20;

  enter(edgeId: string): void {
    this.edgeOccupancy.set(edgeId, (this.edgeOccupancy.get(edgeId) ?? 0) + 1);
  }

  leave(edgeId: string): void {
    const count = (this.edgeOccupancy.get(edgeId) ?? 1) - 1;
    if (count <= 0) this.edgeOccupancy.delete(edgeId);
    else this.edgeOccupancy.set(edgeId, count);
  }

  /**
   * Returns a speed multiplier (0.2 to 1.0) based on edge congestion.
   * At capacity: 0.2 (crawl). Empty: 1.0 (free flow).
   */
  getCongestionFactor(edgeId: string, edgeDistanceKm: number): number {
    const count = this.edgeOccupancy.get(edgeId) ?? 0;
    const capacity = Math.max(1, edgeDistanceKm * TrafficManager.CAPACITY_PER_KM);
    const occupancyRatio = count / capacity;
    // BPR-style congestion: speed drops as occupancy approaches capacity
    return Math.max(0.2, 1 / (1 + occupancyRatio * occupancyRatio));
  }
}

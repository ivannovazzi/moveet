import type { Vehicle, VehicleDTO, Edge, VehicleType } from "../types";
import { VEHICLE_CONSTANTS } from "../constants";
import type { RoadNetwork } from "./RoadNetwork";
import { config } from "../utils/config";
import { CircularBuffer } from "../utils/CircularBuffer";
import { serializeVehicle } from "../utils/serializer";
import type { FleetManager } from "./FleetManager";
import { getProfile } from "../utils/vehicleProfiles";

/**
 * Manages vehicle state: add/remove/get/update vehicles, visited edges, and edge spatial index.
 */
export class VehicleRegistry {
  private vehicles: Map<string, Vehicle> = new Map();
  private visitedEdges: Map<string, CircularBuffer<string>> = new Map();

  // Edge -> vehicle spatial index for O(1) lookups
  private vehiclesByEdge: Map<string, Set<string>> = new Map();

  constructor(
    private network: RoadNetwork,
    private fleetManager: FleetManager
  ) {}

  // ─── Vehicle CRUD ──────────────────────────────────────────────────

  /**
   * Creates a new vehicle with default or random edge start.
   * When seedPosition is provided, finds the nearest node and uses one of
   * its connected edges as the starting edge instead of a random one.
   *
   * @param onVehicleAdded - callback invoked after vehicle is placed (e.g. to set a route)
   */
  addVehicle(
    id: string,
    name: string,
    seedPosition?: [number, number],
    vehicleType: VehicleType = "car",
    onVehicleAdded?: (vehicleId: string) => void
  ): void {
    let startEdge: Edge;

    if (seedPosition) {
      const nearestNode = this.network.findNearestNode(seedPosition);
      if (nearestNode.connections.length > 0) {
        startEdge = nearestNode.connections[0];
      } else {
        startEdge = this.network.getRandomEdge();
      }
    } else {
      startEdge = this.network.getRandomEdge();
    }

    const profile = getProfile(vehicleType);
    this.vehicles.set(id, {
      id,
      name,
      type: vehicleType,
      currentEdge: startEdge,
      position: startEdge.start.coordinates,
      speed: profile.minSpeed,
      bearing: startEdge.bearing,
      progress: 0,
    });

    this.addToEdgeIndex(id, startEdge.id);
    const buffer = new CircularBuffer<string>(VEHICLE_CONSTANTS.MAX_VISITED_EDGES);
    buffer.add(startEdge.id);
    this.visitedEdges.set(id, buffer);

    onVehicleAdded?.(id);
  }

  /**
   * Loads vehicles from config or type distribution.
   */
  loadFromData(
    vehicleTypes?: Partial<Record<VehicleType, number>>,
    onVehicleAdded?: (vehicleId: string) => void
  ): void {
    if (vehicleTypes && Object.keys(vehicleTypes).length > 0) {
      let idx = 0;
      for (const [type, count] of Object.entries(vehicleTypes)) {
        for (let i = 0; i < (count as number); i++) {
          this.addVehicle(
            idx.toString(),
            `V${idx}`,
            undefined,
            type as VehicleType,
            onVehicleAdded
          );
          idx++;
        }
      }
    } else {
      for (let i = 0; i < config.vehicleCount; i++) {
        this.addVehicle(i.toString(), `V${i}`, undefined, "car", onVehicleAdded);
      }
    }
  }

  get(vehicleId: string): Vehicle | undefined {
    return this.vehicles.get(vehicleId);
  }

  has(vehicleId: string): boolean {
    return this.vehicles.has(vehicleId);
  }

  getAll(): Map<string, Vehicle> {
    return this.vehicles;
  }

  getAllSerialized(): VehicleDTO[] {
    return Array.from(this.vehicles.values()).map((v) =>
      serializeVehicle(v, this.fleetManager.getVehicleFleetId(v.id))
    );
  }

  // ─── Visited edges ────────────────────────────────────────────────

  getVisitedEdges(vehicleId: string): CircularBuffer<string> | undefined {
    return this.visitedEdges.get(vehicleId);
  }

  // ─── Edge spatial index management ────────────────────────────────

  addToEdgeIndex(vehicleId: string, edgeId: string): void {
    let vehiclesOnEdge = this.vehiclesByEdge.get(edgeId);
    if (!vehiclesOnEdge) {
      vehiclesOnEdge = new Set();
      this.vehiclesByEdge.set(edgeId, vehiclesOnEdge);
    }
    vehiclesOnEdge.add(vehicleId);
  }

  removeFromEdgeIndex(vehicleId: string, edgeId: string): void {
    const vehiclesOnEdge = this.vehiclesByEdge.get(edgeId);
    if (vehiclesOnEdge) {
      vehiclesOnEdge.delete(vehicleId);
      if (vehiclesOnEdge.size === 0) {
        this.vehiclesByEdge.delete(edgeId);
      }
    }
  }

  moveInEdgeIndex(vehicleId: string, fromEdgeId: string, toEdgeId: string): void {
    this.removeFromEdgeIndex(vehicleId, fromEdgeId);
    this.addToEdgeIndex(vehicleId, toEdgeId);
  }

  getVehiclesByEdge(): Map<string, Set<string>> {
    return this.vehiclesByEdge;
  }

  getVehiclesOnEdge(edgeId: string): Set<string> | undefined {
    return this.vehiclesByEdge.get(edgeId);
  }

  /**
   * Finds the nearest vehicle ahead on the same edge.
   * Uses the edge spatial index for O(1) lookup of candidates.
   */
  findVehicleAhead(vehicle: Vehicle): Vehicle | undefined {
    const edgeId = vehicle.currentEdge.id;
    const vehicleIdsOnEdge = this.vehiclesByEdge.get(edgeId);
    if (!vehicleIdsOnEdge) return undefined;

    let closestAhead: Vehicle | undefined;
    let closestProgress = Infinity;

    for (const id of vehicleIdsOnEdge) {
      if (id === vehicle.id) continue;
      const other = this.vehicles.get(id);
      if (!other) continue;
      if (other.progress > vehicle.progress && other.progress < closestProgress) {
        closestProgress = other.progress;
        closestAhead = other;
      }
    }

    return closestAhead;
  }

  // ─── Reset ────────────────────────────────────────────────────────

  /**
   * Clears all vehicle state for a reset. Caller should re-add vehicles after.
   */
  reset(): void {
    this.vehicles = new Map();
    this.visitedEdges = new Map();
    this.vehiclesByEdge = new Map();
  }
}

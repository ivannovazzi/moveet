/**
 * Shared vehicle store — single source of truth for vehicle DTOs.
 *
 * Two consumers at different speeds:
 * - VehiclesLayer: reads directly from the store on every RAF frame (fast)
 * - React (control panel): subscribes to throttled snapshots (slow, 1s)
 */
import type { Position, VehicleDTO } from "@/types";

type Listener = () => void;

class VehicleStore {
  private vehicles = new Map<string, VehicleDTO>();
  private listeners = new Set<Listener>();
  private version = 0;
  private trails = new Map<string, Position[]>();
  private trailCapacity = 60;

  /** Called from WS handler — fast, no React involvement. */
  set(vehicle: VehicleDTO): void {
    this.vehicles.set(vehicle.id, vehicle);
    this.version++;

    // Append position to trail buffer (circular: drop oldest when at capacity)
    const pos: Position = [vehicle.position[0], vehicle.position[1]];
    let trail = this.trails.get(vehicle.id);
    if (!trail) {
      trail = [];
      this.trails.set(vehicle.id, trail);
    }
    trail.push(pos);
    if (trail.length > this.trailCapacity) {
      trail.splice(0, trail.length - this.trailCapacity);
    }
  }

  /** Bulk replace (e.g. on reset / initial load). */
  replace(vehicles: VehicleDTO[]): void {
    this.vehicles.clear();
    this.trails.clear();
    for (const v of vehicles) this.vehicles.set(v.id, v);
    this.version++;
    this.notify();
  }

  /** Direct access for D3 rendering (no copy). */
  getAll(): Map<string, VehicleDTO> {
    return this.vehicles;
  }

  /** Snapshot as array for React state. */
  snapshot(): VehicleDTO[] {
    return Array.from(this.vehicles.values());
  }

  getVersion(): number {
    return this.version;
  }

  /** Get trail positions for a specific vehicle. */
  getTrail(vehicleId: string): Position[] {
    return this.trails.get(vehicleId) ?? [];
  }

  /** Get all trails (direct access for rendering). */
  getAllTrails(): Map<string, Position[]> {
    return this.trails;
  }

  /** Set the maximum trail length (number of positions kept). */
  setTrailCapacity(n: number): void {
    this.trailCapacity = n;
    // Trim existing trails that exceed the new capacity
    for (const [, trail] of this.trails) {
      if (trail.length > n) {
        trail.splice(0, trail.length - n);
      }
    }
  }

  /** Remove all trail data. */
  clearTrails(): void {
    this.trails.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }
}

export const vehicleStore = new VehicleStore();

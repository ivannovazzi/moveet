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
  private pending: VehicleDTO[] = [];

  /**
   * Queue an incoming WS update. Queued updates are applied together in a
   * single synchronous pass right before the next store read (RAF frame or
   * React throttle tick), so readers never observe a partially-applied batch.
   */
  enqueue(vehicle: VehicleDTO): void {
    this.pending.push(vehicle);
  }

  /** Apply all queued WS updates atomically. */
  private flushPending(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    for (const v of batch) this.set(v);
  }

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

  /** Remove a single vehicle and its trail data (e.g. on despawn). */
  remove(id: string): void {
    this.vehicles.delete(id);
    this.trails.delete(id);
    this.version++;
  }

  /** Bulk replace (e.g. on reset / initial load). */
  replace(vehicles: VehicleDTO[]): void {
    // Drop queued updates — they predate the replacement and would
    // otherwise be re-applied on the next read, overwriting fresh state.
    this.pending = [];
    this.vehicles.clear();
    this.trails.clear();
    for (const v of vehicles) this.vehicles.set(v.id, v);
    this.version++;
    this.notify();
  }

  /** Direct access for D3 rendering (no copy). */
  getAll(): Map<string, VehicleDTO> {
    this.flushPending();
    return this.vehicles;
  }

  /** Snapshot as array for React state. */
  snapshot(): VehicleDTO[] {
    this.flushPending();
    return Array.from(this.vehicles.values());
  }

  getVersion(): number {
    this.flushPending();
    return this.version;
  }

  /** Get trail positions for a specific vehicle. */
  getTrail(vehicleId: string): Position[] {
    this.flushPending();
    return this.trails.get(vehicleId) ?? [];
  }

  /** Get all trails (direct access for rendering). */
  getAllTrails(): Map<string, Position[]> {
    this.flushPending();
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

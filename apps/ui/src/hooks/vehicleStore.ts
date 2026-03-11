/**
 * Shared vehicle store — single source of truth for vehicle DTOs.
 *
 * Two consumers at different speeds:
 * - VehiclesLayer: reads directly from the store on every RAF frame (fast)
 * - React (control panel): subscribes to throttled snapshots (slow, 1s)
 */
import type { VehicleDTO } from "@/types";

type Listener = () => void;

class VehicleStore {
  private vehicles = new Map<string, VehicleDTO>();
  private listeners = new Set<Listener>();
  private version = 0;

  /** Called from WS handler — fast, no React involvement. */
  set(vehicle: VehicleDTO): void {
    this.vehicles.set(vehicle.id, vehicle);
    this.version++;
  }

  /** Bulk replace (e.g. on reset / initial load). */
  replace(vehicles: VehicleDTO[]): void {
    this.vehicles.clear();
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const l of this.listeners) l();
  }
}

export const vehicleStore = new VehicleStore();

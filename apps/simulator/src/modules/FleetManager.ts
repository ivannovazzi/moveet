import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { Fleet } from "../types";

const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#dcbeff",
];

export class FleetManager extends EventEmitter {
  private fleets = new Map<string, Fleet>();
  private vehicleFleetMap = new Map<string, string>();
  private colorIndex = 0;

  createFleet(name: string, source: "local" | "external" = "local"): Fleet {
    const fleet: Fleet = {
      id: randomUUID(),
      name,
      color: PALETTE[this.colorIndex % PALETTE.length],
      source,
      vehicleIds: [],
    };
    this.colorIndex++;
    this.fleets.set(fleet.id, fleet);
    this.emit("fleet:created", fleet);
    return fleet;
  }

  deleteFleet(id: string): void {
    const fleet = this.fleets.get(id);
    if (!fleet) throw new Error(`Fleet ${id} not found`);
    if (fleet.source === "external") throw new Error("Cannot delete external fleet");
    for (const vid of fleet.vehicleIds) {
      this.vehicleFleetMap.delete(vid);
    }
    this.fleets.delete(id);
    this.emit("fleet:deleted", { id });
  }

  assignVehicles(fleetId: string, vehicleIds: string[]): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) throw new Error(`Fleet ${fleetId} not found`);
    for (const vid of vehicleIds) {
      const prevFleetId = this.vehicleFleetMap.get(vid);
      if (prevFleetId && prevFleetId !== fleetId) {
        const prevFleet = this.fleets.get(prevFleetId);
        if (prevFleet) {
          prevFleet.vehicleIds = prevFleet.vehicleIds.filter((v) => v !== vid);
        }
      }
      this.vehicleFleetMap.set(vid, fleetId);
      if (!fleet.vehicleIds.includes(vid)) {
        fleet.vehicleIds.push(vid);
      }
    }
    this.emit("fleet:assigned", { fleetId, vehicleIds });
  }

  unassignVehicles(fleetId: string, vehicleIds: string[]): void {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) throw new Error(`Fleet ${fleetId} not found`);
    for (const vid of vehicleIds) {
      fleet.vehicleIds = fleet.vehicleIds.filter((v) => v !== vid);
      this.vehicleFleetMap.delete(vid);
    }
    this.emit("fleet:assigned", { fleetId: null, vehicleIds });
  }

  getFleets(): Fleet[] {
    return Array.from(this.fleets.values());
  }

  getVehicleFleetId(vehicleId: string): string | undefined {
    return this.vehicleFleetMap.get(vehicleId);
  }

  reset(): void {
    this.fleets.clear();
    this.vehicleFleetMap.clear();
    this.colorIndex = 0;
  }
}

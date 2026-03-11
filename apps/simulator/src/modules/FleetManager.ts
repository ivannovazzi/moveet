import { EventEmitter } from "events";
import type { FleetDTO } from "../types";
import { FLEET_COLORS } from "../constants";
import logger from "../utils/logger";

interface FleetState {
  id: string;
  name: string;
  color: string;
  vehicleIds: Set<string>;
}

export class FleetManager extends EventEmitter {
  private fleets: Map<string, FleetState> = new Map();
  private vehicleFleetMap: Map<string, string> = new Map();
  private colorIndex = 0;
  private idCounter = 0;

  private nextColor(): string {
    const color = FLEET_COLORS[this.colorIndex % FLEET_COLORS.length];
    this.colorIndex++;
    return color;
  }

  private generateId(): string {
    return `fleet-${++this.idCounter}`;
  }

  private serializeFleet(fleet: FleetState): FleetDTO {
    return {
      id: fleet.id,
      name: fleet.name,
      color: fleet.color,
      vehicleIds: Array.from(fleet.vehicleIds),
    };
  }

  public create(name: string): FleetDTO {
    const id = this.generateId();
    const fleet: FleetState = {
      id,
      name,
      color: this.nextColor(),
      vehicleIds: new Set(),
    };
    this.fleets.set(id, fleet);
    const dto = this.serializeFleet(fleet);
    this.emit("fleet:created", dto);
    logger.info(`Fleet created: ${id} (${name})`);
    return dto;
  }

  public delete(fleetId: string): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    // Unassign all vehicles from this fleet
    for (const vehicleId of fleet.vehicleIds) {
      this.vehicleFleetMap.delete(vehicleId);
    }

    this.fleets.delete(fleetId);
    this.emit("fleet:deleted", { id: fleetId });
    logger.info(`Fleet deleted: ${fleetId}`);
    return true;
  }

  public assign(fleetId: string, vehicleId: string): boolean {
    const fleet = this.fleets.get(fleetId);
    if (!fleet) return false;

    // Remove from previous fleet if assigned
    const previousFleetId = this.vehicleFleetMap.get(vehicleId);
    if (previousFleetId) {
      const prevFleet = this.fleets.get(previousFleetId);
      prevFleet?.vehicleIds.delete(vehicleId);
    }

    fleet.vehicleIds.add(vehicleId);
    this.vehicleFleetMap.set(vehicleId, fleetId);
    this.emit("fleet:assigned", { fleetId, vehicleId });
    logger.info(`Vehicle ${vehicleId} assigned to fleet ${fleetId}`);
    return true;
  }

  public unassign(vehicleId: string): boolean {
    const fleetId = this.vehicleFleetMap.get(vehicleId);
    if (!fleetId) return false;

    const fleet = this.fleets.get(fleetId);
    fleet?.vehicleIds.delete(vehicleId);
    this.vehicleFleetMap.delete(vehicleId);
    this.emit("fleet:assigned", { fleetId: null, vehicleId });
    logger.info(`Vehicle ${vehicleId} unassigned from fleet ${fleetId}`);
    return true;
  }

  public getAll(): FleetDTO[] {
    return Array.from(this.fleets.values()).map((f) => this.serializeFleet(f));
  }

  public get(fleetId: string): FleetDTO | undefined {
    const fleet = this.fleets.get(fleetId);
    return fleet ? this.serializeFleet(fleet) : undefined;
  }

  public getFleetIdForVehicle(vehicleId: string): string | undefined {
    return this.vehicleFleetMap.get(vehicleId);
  }

  public reset(): void {
    this.fleets.clear();
    this.vehicleFleetMap.clear();
    this.colorIndex = 0;
    this.idCounter = 0;
  }
}

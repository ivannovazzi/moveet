import type { ClientDeps } from "./types";
import type { ApiResponse, Fleet } from "@/types";
import type { WaypointReachedPayload, RouteCompletedPayload } from "../wsTypes";

/** Fleet CRUD + assignment, plus fleet/route lifecycle WS events. */
export class FleetSegment {
  constructor(private deps: ClientDeps) {
    this.getFleets = this.getFleets.bind(this);
    this.createFleet = this.createFleet.bind(this);
    this.deleteFleet = this.deleteFleet.bind(this);
    this.assignVehicles = this.assignVehicles.bind(this);
    this.unassignVehicles = this.unassignVehicles.bind(this);
    this.onFleetCreated = this.onFleetCreated.bind(this);
    this.offFleetCreated = this.offFleetCreated.bind(this);
    this.onFleetDeleted = this.onFleetDeleted.bind(this);
    this.offFleetDeleted = this.offFleetDeleted.bind(this);
    this.onFleetAssigned = this.onFleetAssigned.bind(this);
    this.offFleetAssigned = this.offFleetAssigned.bind(this);
    this.onWaypointReached = this.onWaypointReached.bind(this);
    this.offWaypointReached = this.offWaypointReached.bind(this);
    this.onRouteCompleted = this.onRouteCompleted.bind(this);
    this.offRouteCompleted = this.offRouteCompleted.bind(this);
  }

  async getFleets(): Promise<ApiResponse<Fleet[]>> {
    return this.deps.http.get<Fleet[]>("/fleets");
  }

  async createFleet(name: string): Promise<ApiResponse<Fleet>> {
    return this.deps.http.post<{ name: string }, Fleet>("/fleets", { name });
  }

  async deleteFleet(id: string): Promise<ApiResponse<void>> {
    return this.deps.http.delete(`/fleets/${id}`);
  }

  async assignVehicles(fleetId: string, vehicleIds: string[]): Promise<ApiResponse<void>> {
    return this.deps.http.post<{ vehicleIds: string[] }>(`/fleets/${fleetId}/assign`, {
      vehicleIds,
    });
  }

  async unassignVehicles(fleetId: string, vehicleIds: string[]): Promise<ApiResponse<void>> {
    return this.deps.http.post<{ vehicleIds: string[] }>(`/fleets/${fleetId}/unassign`, {
      vehicleIds,
    });
  }

  onFleetCreated(handler: (fleet: Fleet) => void): void {
    this.deps.ws.on("fleet:created", handler);
  }

  offFleetCreated(handler?: (fleet: Fleet) => void): void {
    this.deps.ws.off("fleet:created", handler);
  }

  onFleetDeleted(handler: (data: { id: string }) => void): void {
    this.deps.ws.on("fleet:deleted", handler);
  }

  offFleetDeleted(handler?: (data: { id: string }) => void): void {
    this.deps.ws.off("fleet:deleted", handler);
  }

  onFleetAssigned(handler: (data: { fleetId: string | null; vehicleIds: string[] }) => void): void {
    this.deps.ws.on("fleet:assigned", handler);
  }

  offFleetAssigned(
    handler?: (data: { fleetId: string | null; vehicleIds: string[] }) => void
  ): void {
    this.deps.ws.off("fleet:assigned", handler);
  }

  onWaypointReached(handler: (data: WaypointReachedPayload) => void): void {
    this.deps.ws.on("waypoint:reached", handler);
  }

  offWaypointReached(handler?: (data: WaypointReachedPayload) => void): void {
    this.deps.ws.off("waypoint:reached", handler);
  }

  onRouteCompleted(handler: (data: RouteCompletedPayload) => void): void {
    this.deps.ws.on("route:completed", handler);
  }

  offRouteCompleted(handler?: (data: RouteCompletedPayload) => void): void {
    this.deps.ws.off("route:completed", handler);
  }
}

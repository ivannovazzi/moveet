import type { ClientDeps } from "./types";
import type { ApiResponse, IncidentDTO, IncidentType } from "@/types";
import type { IncidentClearedPayload, VehicleReroutedPayload } from "../wsTypes";

/** Incident creation/removal + incident/reroute WS events. */
export class IncidentSegment {
  constructor(private deps: ClientDeps) {
    this.getIncidents = this.getIncidents.bind(this);
    this.createRandomIncident = this.createRandomIncident.bind(this);
    this.removeIncident = this.removeIncident.bind(this);
    this.createIncidentAtPosition = this.createIncidentAtPosition.bind(this);
    this.onIncidentCreated = this.onIncidentCreated.bind(this);
    this.offIncidentCreated = this.offIncidentCreated.bind(this);
    this.onIncidentCleared = this.onIncidentCleared.bind(this);
    this.offIncidentCleared = this.offIncidentCleared.bind(this);
    this.onVehicleRerouted = this.onVehicleRerouted.bind(this);
    this.offVehicleRerouted = this.offVehicleRerouted.bind(this);
  }

  async getIncidents(): Promise<ApiResponse<IncidentDTO[]>> {
    return this.deps.http.get<IncidentDTO[]>("/incidents");
  }

  async createRandomIncident(): Promise<ApiResponse<IncidentDTO>> {
    return this.deps.http.post<undefined, IncidentDTO>("/incidents/random");
  }

  async removeIncident(id: string): Promise<ApiResponse<void>> {
    return this.deps.http.delete(`/incidents/${id}`);
  }

  async createIncidentAtPosition(
    lat: number,
    lng: number,
    type: IncidentType
  ): Promise<ApiResponse<IncidentDTO>> {
    return this.deps.http.post("/incidents/at-position", { lat, lng, type });
  }

  onIncidentCreated(handler: (data: IncidentDTO) => void): void {
    this.deps.ws.on("incident:created", handler);
  }

  offIncidentCreated(handler?: (data: IncidentDTO) => void): void {
    this.deps.ws.off("incident:created", handler);
  }

  onIncidentCleared(handler: (data: IncidentClearedPayload) => void): void {
    this.deps.ws.on("incident:cleared", handler);
  }

  offIncidentCleared(handler?: (data: IncidentClearedPayload) => void): void {
    this.deps.ws.off("incident:cleared", handler);
  }

  onVehicleRerouted(handler: (data: VehicleReroutedPayload) => void): void {
    this.deps.ws.on("vehicle:rerouted", handler);
  }

  offVehicleRerouted(handler?: (data: VehicleReroutedPayload) => void): void {
    this.deps.ws.off("vehicle:rerouted", handler);
  }
}

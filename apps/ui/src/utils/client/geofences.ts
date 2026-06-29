import type { ClientDeps } from "./types";
import type { ApiResponse } from "@/types";
import type {
  GeoFence,
  GeoFenceEvent,
  CreateGeoFenceRequest,
  UpdateGeoFenceRequest,
  SubscribeFilter,
} from "@moveet/shared-types";

/** Geofence CRUD/toggle, geofence WS events, and the bbox subscribe control. */
export class GeofenceSegment {
  constructor(private deps: ClientDeps) {
    this.getGeofences = this.getGeofences.bind(this);
    this.createGeofence = this.createGeofence.bind(this);
    this.updateGeofence = this.updateGeofence.bind(this);
    this.deleteGeofence = this.deleteGeofence.bind(this);
    this.toggleGeofence = this.toggleGeofence.bind(this);
    this.onGeofenceEvent = this.onGeofenceEvent.bind(this);
    this.offGeofenceEvent = this.offGeofenceEvent.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  async getGeofences(): Promise<ApiResponse<GeoFence[]>> {
    return this.deps.http.get<GeoFence[]>("/geofences");
  }

  async createGeofence(req: CreateGeoFenceRequest): Promise<ApiResponse<GeoFence>> {
    return this.deps.http.post<CreateGeoFenceRequest, GeoFence>("/geofences", req);
  }

  async updateGeofence(id: string, req: UpdateGeoFenceRequest): Promise<ApiResponse<GeoFence>> {
    return this.deps.http.patch<UpdateGeoFenceRequest, GeoFence>(`/geofences/${id}`, req);
  }

  async deleteGeofence(id: string): Promise<ApiResponse<void>> {
    return this.deps.http.delete(`/geofences/${id}`);
  }

  async toggleGeofence(id: string): Promise<ApiResponse<GeoFence>> {
    return this.deps.http.post<undefined, GeoFence>(`/geofences/${id}/toggle`);
  }

  onGeofenceEvent(handler: (event: GeoFenceEvent) => void): void {
    this.deps.ws.on("geofence:event", handler);
  }

  offGeofenceEvent(handler?: (event: GeoFenceEvent) => void): void {
    this.deps.ws.off("geofence:event", handler);
  }

  subscribe(filter: SubscribeFilter | null): void {
    this.deps.ws.send({ type: "subscribe", filter });
  }
}

import { EventEmitter } from "events";
import type { GeoFence, GeoFenceEvent } from "@moveet/shared-types";
import type { VehicleDTO } from "../types";

/**
 * Determines whether a point [lng, lat] is inside a polygon using the
 * standard ray-casting algorithm.
 *
 * @param point  [longitude, latitude]
 * @param polygon  Array of [longitude, latitude] coordinate pairs
 */
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Manages geofence zones and emits enter/exit events as vehicles cross zone
 * boundaries. Uses ray-casting for point-in-polygon checks.
 *
 * Emits: 'geofence-event' (GeoFenceEvent) on each enter/exit transition.
 */
export class GeoFenceManager extends EventEmitter {
  /** Active and inactive zones keyed by fence id. */
  private readonly zones: Map<string, GeoFence> = new Map();

  /**
   * Per-vehicle zone membership: vehicleId → Set of fenceIds the vehicle is
   * currently inside.
   */
  private readonly membership: Map<string, Set<string>> = new Map();

  // ─── Zone CRUD ────────────────────────────────────────────────────

  addZone(fence: GeoFence): void {
    this.zones.set(fence.id, fence);
  }

  updateZone(id: string, patch: Partial<GeoFence>): GeoFence | null {
    const existing = this.zones.get(id);
    if (!existing) return null;
    const updated: GeoFence = { ...existing, ...patch, id };
    this.zones.set(id, updated);
    return updated;
  }

  removeZone(id: string): boolean {
    const existed = this.zones.has(id);
    if (existed) {
      this.zones.delete(id);
      // Clean up membership tracking for this zone
      for (const [, fences] of this.membership) {
        fences.delete(id);
      }
    }
    return existed;
  }

  getZone(id: string): GeoFence | undefined {
    return this.zones.get(id);
  }

  getAllZones(): GeoFence[] {
    return Array.from(this.zones.values());
  }

  /**
   * Flips the `active` flag of a zone.
   * Returns the updated zone, or null if not found.
   */
  toggleZone(id: string): GeoFence | null {
    const existing = this.zones.get(id);
    if (!existing) return null;
    const updated: GeoFence = { ...existing, active: !existing.active };
    this.zones.set(id, updated);
    return updated;
  }

  // ─── Vehicle checking ─────────────────────────────────────────────

  /**
   * Checks all active zones for each vehicle and detects enter/exit
   * transitions. Emits `"geofence-event"` for each transition detected.
   *
   * Vehicle position is [lat, lng]; polygon coordinates are [lng, lat].
   * We reorder to [lng, lat] before passing to pointInPolygon.
   */
  checkVehicles(vehicles: VehicleDTO[]): void {
    for (const [, zone] of this.zones) {
      if (!zone.active) continue;

      for (const vehicle of vehicles) {
        // VehicleDTO.position is [lat, lng]; convert to [lng, lat] for the polygon
        const point: [number, number] = [vehicle.position[1], vehicle.position[0]];
        const isInside = pointInPolygon(point, zone.polygon);

        // Ensure we have a membership set for this vehicle
        if (!this.membership.has(vehicle.id)) {
          this.membership.set(vehicle.id, new Set());
        }
        const vehicleFences = this.membership.get(vehicle.id)!;

        const wasInside = vehicleFences.has(zone.id);

        if (isInside && !wasInside) {
          // Enter transition
          vehicleFences.add(zone.id);
          const event: GeoFenceEvent = {
            type: "geofence-event",
            fenceId: zone.id,
            fenceName: zone.name,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            event: "enter",
            timestamp: new Date().toISOString(),
          };
          this.emit("geofence-event", event);
        } else if (!isInside && wasInside) {
          // Exit transition
          vehicleFences.delete(zone.id);
          const event: GeoFenceEvent = {
            type: "geofence-event",
            fenceId: zone.id,
            fenceName: zone.name,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            event: "exit",
            timestamp: new Date().toISOString(),
          };
          this.emit("geofence-event", event);
        }
      }
    }
  }
}

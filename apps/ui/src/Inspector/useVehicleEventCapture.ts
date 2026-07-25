import { useEffect } from "react";
import client from "@/utils/client";
import type { VehicleDirection } from "@/types";
import type {
  GeoFenceEvent,
  RouteCompletedPayload,
  VehicleReroutedPayload,
  WaypointReachedPayload,
} from "@moveet/shared-types";
import { vehicleEventStore } from "./vehicleEventStore";

/**
 * Fills `vehicleEventStore` from the WS channels that carry a `vehicleId`.
 *
 * Mounted once from `Inspector`, which App renders unconditionally (it returns
 * null internally when nothing is selected). So capture runs from app start
 * and a vehicle selected later still has history — without adding a listener
 * set anywhere else or touching App.
 *
 * Sourced channels: `vehicle:rerouted`, `geofence:event`, `waypoint:reached`,
 * `route:completed`, `direction`. `incident:created` is deliberately *not*
 * captured: it carries a position but no vehicle, so it cannot be attributed
 * to one. A vehicle's contact with an incident is only observable via the
 * `vehicle:rerouted` frame, which carries the `incidentId`.
 */
export function useVehicleEventCapture(): void {
  useEffect(() => {
    const onRerouted = (data: VehicleReroutedPayload) => {
      vehicleEventStore.record({
        vehicleId: data.vehicleId,
        kind: "reroute",
        at: Date.now(),
        label: "Rerouted around incident",
        detail: data.incidentId,
      });
    };

    const onGeofence = (event: GeoFenceEvent) => {
      const entered = event.event === "enter";
      const at = Date.parse(event.timestamp);
      vehicleEventStore.record({
        vehicleId: event.vehicleId,
        kind: entered ? "geofence-enter" : "geofence-exit",
        at: Number.isNaN(at) ? Date.now() : at,
        label: `${entered ? "Entered" : "Exited"} ${event.fenceName}`,
        detail: event.fenceId,
      });
    };

    const onWaypoint = (data: WaypointReachedPayload) => {
      vehicleEventStore.record({
        vehicleId: data.vehicleId,
        kind: "waypoint",
        at: Date.now(),
        label: `Reached ${data.waypointLabel ?? `waypoint ${data.waypointIndex + 1}`}`,
        detail: data.remaining > 0 ? `${data.remaining} left` : "last waypoint",
      });
    };

    const onCompleted = (data: RouteCompletedPayload) => {
      vehicleEventStore.record({
        vehicleId: data.vehicleId,
        kind: "arrival",
        at: Date.now(),
        label: "Route completed",
      });
    };

    const onDirection = (data: VehicleDirection) => {
      const km = data.route?.distance;
      vehicleEventStore.record({
        vehicleId: data.vehicleId,
        kind: "route",
        at: Date.now(),
        label: "New route assigned",
        detail: typeof km === "number" && km > 0 ? `${km.toFixed(1)} km` : undefined,
      });
    };

    // Guarded so a partially-stubbed client (other suites mock the singleton)
    // can't take the inspector down.
    client.onVehicleRerouted?.(onRerouted);
    client.onGeofenceEvent?.(onGeofence);
    client.onWaypointReached?.(onWaypoint);
    client.onRouteCompleted?.(onCompleted);
    client.onDirection?.(onDirection);

    return () => {
      client.offVehicleRerouted?.(onRerouted);
      client.offGeofenceEvent?.(onGeofence);
      client.offWaypointReached?.(onWaypoint);
      client.offRouteCompleted?.(onCompleted);
      client.offDirection?.(onDirection);
    };
  }, []);
}

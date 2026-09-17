import { useDirectionContext } from "@/data/useData";
import type { EtaBreakdown, Route, VehicleDirection, VehicleEtaUpdate } from "@/types";
import client from "@/utils/client";
import { useCallback, useEffect } from "react";

export interface DirectionState {
  route: Route;
  /** Estimated time of arrival in seconds, when the simulator provides it. */
  eta?: number;
  /**
   * How the route's ETA breaks down (driving / stops / turns, plus the weather
   * factor and the learned-speed share it was priced with). Whole-route, fixed
   * at assignment — the LIVE remainder rides the vehicle sample instead.
   */
  etaBreakdown?: EtaBreakdown;
  waypoints?: VehicleDirection["waypoints"];
  currentWaypointIndex?: number;
}

function toState(direction: VehicleDirection): DirectionState {
  return {
    route: direction.route,
    eta: direction.eta,
    etaBreakdown: direction.etaBreakdown,
    waypoints: direction.waypoints,
    currentWaypointIndex: direction.currentWaypointIndex,
  };
}

function buildDirectionMap(directions: VehicleDirection[]): Map<string, DirectionState> {
  const directionMap = new Map<string, DirectionState>();
  for (const direction of directions) {
    directionMap.set(direction.vehicleId, toState(direction));
  }
  return directionMap;
}

export function useDirections() {
  const { directions, setDirections } = useDirectionContext();

  const fetchDirections = useCallback(() => {
    client
      .getDirections()
      .then((directions) => {
        if (!directions.data) return;
        setDirections(buildDirectionMap(directions.data));
      })
      .catch((err) => console.error("Failed to load directions:", err));
  }, [setDirections]);

  useEffect(() => {
    fetchDirections();

    const connectHandler = () => fetchDirections();
    const directionHandler = (direction: VehicleDirection) => {
      setDirections((prev) => {
        const updated = new Map(prev);
        updated.set(direction.vehicleId, toState(direction));
        return updated;
      });
    };

    // Routes repriced without changing (the weather factor moved). Patches the
    // ETA figures in place: the routes are untouched, so replacing them would
    // discard nothing but cost a full re-render of every step list.
    const etaHandler = (updates: VehicleEtaUpdate[]) => {
      setDirections((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const update of updates) {
          const existing = next.get(update.vehicleId);
          if (!existing) continue;
          next.set(update.vehicleId, {
            ...existing,
            eta: update.eta,
            etaBreakdown: update.etaBreakdown,
          });
          changed = true;
        }
        return changed ? next : prev;
      });
    };

    const waypointHandler = (data: { vehicleId: string; waypointIndex: number }) => {
      setDirections((prev) => {
        const existing = prev.get(data.vehicleId);
        if (!existing) return prev;
        const updated = new Map(prev);
        updated.set(data.vehicleId, {
          ...existing,
          currentWaypointIndex: data.waypointIndex,
        });
        return updated;
      });
    };

    const routeHandler = (data: { vehicleId: string }) => {
      setDirections((prev) => {
        if (!prev.has(data.vehicleId)) return prev;
        const updated = new Map(prev);
        updated.delete(data.vehicleId);
        return updated;
      });
    };

    const resetHandler = (data: { directions: VehicleDirection[] }) => {
      setDirections(buildDirectionMap(data.directions));
    };

    client.onConnect(connectHandler);
    client.onDirection(directionHandler);
    client.onEta(etaHandler);
    client.onWaypointReached(waypointHandler);
    client.onRouteCompleted(routeHandler);
    client.onReset(resetHandler);

    return () => {
      client.offConnect(connectHandler);
      client.offDirection(directionHandler);
      client.offEta(etaHandler);
      client.offWaypointReached(waypointHandler);
      client.offRouteCompleted(routeHandler);
      client.offReset(resetHandler);
    };
  }, [setDirections, fetchDirections]);

  return directions;
}

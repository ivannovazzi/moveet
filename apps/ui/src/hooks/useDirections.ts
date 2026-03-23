import { useDirectionContext } from "@/data/useData";
import type { Route, VehicleDirection } from "@/types";
import client from "@/utils/client";
import { useCallback, useEffect } from "react";

export interface DirectionState {
  route: Route;
  waypoints?: VehicleDirection["waypoints"];
  currentWaypointIndex?: number;
}

function buildDirectionMap(directions: VehicleDirection[]): Map<string, DirectionState> {
  const directionMap = new Map<string, DirectionState>();
  for (const direction of directions) {
    directionMap.set(direction.vehicleId, {
      route: direction.route,
      waypoints: direction.waypoints,
      currentWaypointIndex: direction.currentWaypointIndex,
    });
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
        updated.set(direction.vehicleId, {
          route: direction.route,
          waypoints: direction.waypoints,
          currentWaypointIndex: direction.currentWaypointIndex,
        });
        return updated;
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
    client.onWaypointReached(waypointHandler);
    client.onRouteCompleted(routeHandler);
    client.onReset(resetHandler);

    return () => {
      client.offConnect(connectHandler);
      client.offDirection(directionHandler);
      client.offWaypointReached(waypointHandler);
      client.offRouteCompleted(routeHandler);
      client.offReset(resetHandler);
    };
  }, [setDirections, fetchDirections]);

  return directions;
}

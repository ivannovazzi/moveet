import useData from "@/data/useData";
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
  const { directions, setDirections } = useData();

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

    client.onConnect(() => {
      fetchDirections();
    });

    client.onDirection((direction) => {
      setDirections((prev) => {
        const updated = new Map(prev);
        updated.set(direction.vehicleId, {
          route: direction.route,
          waypoints: direction.waypoints,
          currentWaypointIndex: direction.currentWaypointIndex,
        });
        return updated;
      });
    });

    client.onWaypointReached((data) => {
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
    });

    client.onRouteCompleted((data) => {
      setDirections((prev) => {
        if (!prev.has(data.vehicleId)) return prev;
        const updated = new Map(prev);
        updated.delete(data.vehicleId);
        return updated;
      });
    });

    client.onReset((data) => {
      setDirections(buildDirectionMap(data.directions));
    });
  }, [setDirections, fetchDirections]);

  return directions;
}

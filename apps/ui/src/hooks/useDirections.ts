import useData from "@/data/useData";
import type { Route, VehicleDirection } from "@/types";
import client from "@/utils/client";
import { useCallback, useEffect } from "react";

function buildDirectionMap(directions: VehicleDirection[]): Map<string, Route> {
  const directionMap = new Map<string, Route>();
  for (const direction of directions) {
    directionMap.set(direction.vehicleId, direction.route);
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
        const updated = new Map<string, Route>(prev);
        updated.set(direction.vehicleId, direction.route);
        return updated;
      });
    });

    client.onReset((data) => {
      setDirections(buildDirectionMap(data.directions));
    });
  }, [setDirections, fetchDirections]);

  return directions;
}

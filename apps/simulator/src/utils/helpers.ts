import type { Route } from "../types";
import { serializeRoute } from "./serializer";
import { bearingDegrees } from "../modules/pathfinding/turns";

/**
 * Initial bearing in degrees [0, 360) from `start` to `end`. Lives in the shared
 * turn model so the worker's edge bearings are computed by the same code.
 */
export const calculateBearing = bearingDegrees;

export function interpolatePosition(
  start: [number, number],
  end: [number, number],
  fraction: number
): [number, number] {
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

export function calculateDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371; // Earth's radius in km
  const [lat1, lon1] = p1.map((x) => (x * Math.PI) / 180);
  const [lat2, lon2] = p2.map((x) => (x * Math.PI) / 180);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns a non-circular, wire-safe copy of a route (endpoint-node
 * `connections` stripped). Thin alias over {@link serializeRoute}, kept for the
 * existing call sites and tests.
 */
export function nonCircularRouteEdges(route: Route): Route {
  return serializeRoute(route);
}

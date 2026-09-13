import type { Position } from "@/types";

export const calculateRotation = (current: number, target: number) => {
  const normalizedCurrent = ((current % 360) + 360) % 360;
  const normalizedTarget = ((target % 360) + 360) % 360;

  let diff = normalizedTarget - normalizedCurrent;

  // Ensure we take the shortest path
  if (diff > 180) {
    diff -= 360;
  } else if (diff < -180) {
    diff += 360;
  }

  return diff;
};

export function invertLatLng([a, b]: Position): Position {
  return [b, a];
}

/**
 * Convert a [lat, lng] position to [lng, lat] for map projection / GeoJSON.
 * Use when feeding coordinates to D3 projection or any GeoJSON-based API.
 */
export function toMapPosition([lat, lng]: Position): Position {
  return [lng, lat];
}

/**
 * Convert a [lng, lat] map position to [lat, lng] for API calls and waypoints.
 * Inverse of toMapPosition — use when a map click returns [lng, lat] and you
 * need [lat, lng] for the simulator API or Waypoint.position.
 */
export function toLatLng([lng, lat]: Position): Position {
  return [lat, lng];
}

/**
 * The bounding box of a road network, as `[[west, south], [east, north]]` —
 * the shape `useMapControls().setBounds` (and deck.gl's `fitBounds` under it)
 * expects.
 *
 * Returns `null` for an empty network rather than an infinite box: the caller
 * (the map-controls cluster's "Fit network" key) disables itself on `null`
 * instead of flying the camera to nowhere while the network is still loading.
 */
export function networkBounds(geojson: {
  features: { geometry: { coordinates: Position[] } }[];
}): [Position, Position] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of geojson.features) {
    for (const [lng, lat] of feature.geometry.coordinates) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  if (west === Infinity) return null;
  return [
    [west, south],
    [east, north],
  ];
}

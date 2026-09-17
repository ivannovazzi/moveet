import type { Vehicle, VehicleDTO, Route, Edge, Node } from "../types";

/**
 * Internal `Vehicle` -> wire `VehicleDTO`.
 *
 * `etaSeconds` is passed in rather than derived here because route pricing
 * lives in `RouteManager` (see `modules/eta.ts`) and this module must stay a
 * pure shape conversion with no module graph behind it. Callers that have no
 * route context simply omit it, and the field is then absent from the wire.
 */
export function serializeVehicle(
  vehicle: Vehicle,
  fleetId?: string,
  etaSeconds?: number
): VehicleDTO {
  const dto: VehicleDTO = {
    id: vehicle.id,
    name: vehicle.name,
    type: vehicle.type,
    position: vehicle.position,
    speed: vehicle.speed,
    heading: vehicle.bearing,
    fleetId,
  };
  if (etaSeconds !== undefined) dto.etaSeconds = etaSeconds;
  return dto;
}

/**
 * Lean wire copy of a route node: only the fields clients consume
 * (`id`, `coordinates`, optional `trafficSignal`) — NOT the `connections`
 * adjacency graph, which is circular and never serialized.
 */
function serializeRouteNode(node: Node): Node {
  const dto: Node = {
    id: node.id,
    coordinates: node.coordinates,
    // `connections` is required on Node but must be empty on the wire (the full
    // adjacency graph is circular and clients never read it).
    connections: [],
  };
  if (node.trafficSignal !== undefined) dto.trafficSignal = node.trafficSignal;
  return dto;
}

/**
 * Serializes a route's edges into a lean, non-circular wire form.
 *
 * Copies only the wire fields per edge plus lightweight endpoint-node copies
 * (id/coordinates/trafficSignal). It does NOT walk or copy the endpoint nodes'
 * `connections` adjacency graphs. This is the single-pass replacement for the
 * old `nonCircularRouteEdges` clone and is meant to be cached by callers and
 * invalidated on route change (see RouteManager), so repeated `/vehicles` polls
 * and `getStatus` calls don't re-serialize unchanged routes.
 */
export function serializeRoute(route: Route): Route {
  const edges: Edge[] = new Array(route.edges.length);
  for (let i = 0; i < route.edges.length; i++) {
    const edge = route.edges[i];
    const dto: Edge = {
      id: edge.id,
      streetId: edge.streetId,
      start: serializeRouteNode(edge.start),
      end: serializeRouteNode(edge.end),
      distance: edge.distance,
      bearing: edge.bearing,
      highway: edge.highway,
      maxSpeed: edge.maxSpeed,
      surface: edge.surface,
      oneway: edge.oneway,
    };
    if (edge.name !== undefined) dto.name = edge.name;
    if (edge.lanes !== undefined) dto.lanes = edge.lanes;
    if (edge.capacity !== undefined) dto.capacity = edge.capacity;
    if (edge.smoothnessFactor !== undefined) dto.smoothnessFactor = edge.smoothnessFactor;
    edges[i] = dto;
  }
  return { edges, distance: route.distance };
}

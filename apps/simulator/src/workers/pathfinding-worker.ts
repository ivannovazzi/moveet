/**
 * Worker thread for A* pathfinding on the road network.
 *
 * Receives the GeoJSON path via `workerData`, builds a lightweight adjacency
 * graph (no circular references), and processes route requests from the main
 * thread.
 *
 * Protocol:
 *   Request:  { type: 'findRoute', id: number, startId: string, endId: string, incidentEdges?: Record<string, number> }
 *   Response: { type: 'result',    id: number, route: { edgeIds: string[], distance: number } | null }
 */

import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import type { FeatureCollection, LineString } from "geojson";

// ---------------------------------------------------------------------------
// Lightweight graph types (no circular refs)
// ---------------------------------------------------------------------------

interface WorkerEdge {
  id: string;
  streetId: string;
  endNodeId: string;
  distance: number;
  maxSpeed: number;
  surface: string;
  highway: string;
  lanes: number;
  capacity: number;
  smoothnessFactor: number;
}

interface WorkerNode {
  id: string;
  lat: number;
  lon: number;
  edges: WorkerEdge[];
  trafficSignal?: boolean;
}

interface PathNode {
  id: string;
  gScore: number;
  fScore: number;
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

// Module-level max network speed for admissible heuristic (set by buildGraph)
let _maxNetworkSpeed = 110;

type HighwayType =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "unclassified"
  | "living_street";

const DEFAULT_SPEEDS: Record<HighwayType, number> = {
  motorway: 110,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
  unclassified: 35,
  living_street: 20,
};

const VALID_HIGHWAYS = new Set<string>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "unclassified",
  "living_street",
]);

// Coordinate snapping to deduplicate near-identical intersection nodes
const COORD_SNAP_EPSILON = 1e-7;

function snapCoord(val: number): string {
  return (Math.round(val / COORD_SNAP_EPSILON) * COORD_SNAP_EPSILON).toFixed(7);
}

function makeNodeKey(lat: number, lon: number): string {
  return `${snapCoord(lat)},${snapCoord(lon)}`;
}

function parseOneway(value: string | undefined | null): "forward" | "reverse" | false {
  if (!value || value === "no" || value === "false" || value === "0") return false;
  if (value === "-1" || value === "reverse") return "reverse";
  return "forward"; // yes, true, 1
}

function parseMaxSpeed(raw: string | undefined, highway: HighwayType): number {
  if (!raw) return DEFAULT_SPEEDS[highway];
  if (raw.includes("-")) {
    const parts = raw.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return (parts[0] + parts[1]) / 2;
    }
  }
  const parsed = Number(raw);
  return isNaN(parsed) ? DEFAULT_SPEEDS[highway] : parsed;
}

const SMOOTHNESS_FACTORS: Record<string, number> = {
  excellent: 1.0,
  good: 0.9,
  intermediate: 0.75,
  bad: 0.6,
  very_bad: 0.45,
  horrible: 0.3,
  very_horrible: 0.2,
  impassable: 0.0,
};

function parseSmoothness(raw: string | undefined): number {
  if (!raw) return 1.0;
  return SMOOTHNESS_FACTORS[raw] ?? 1.0;
}

function calculateDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371;
  const [lat1, lon1] = p1.map((x) => (x * Math.PI) / 180);
  const [lat2, lon2] = p2.map((x) => (x * Math.PI) / 180);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildGraph(geojsonPath: string): Map<string, WorkerNode> {
  const data: FeatureCollection = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const nodes = new Map<string, WorkerNode>();

  function getOrCreate(id: string, lat: number, lon: number): WorkerNode {
    let node = nodes.get(id);
    if (!node) {
      node = { id, lat, lon, edges: [] };
      nodes.set(id, node);
    }
    return node;
  }

  for (const feature of data.features) {
    if (feature.geometry.type !== "LineString") continue;

    // Skip access-restricted roads (private estates, gated communities)
    const accessTag = feature.properties?.access;
    const motorVehicleTag = feature.properties?.motor_vehicle;
    if (
      accessTag === "private" ||
      accessTag === "no" ||
      motorVehicleTag === "private" ||
      motorVehicleTag === "no"
    ) {
      continue; // skip this feature entirely
    }

    const coords = (feature.geometry as LineString).coordinates;
    const rawHighway = feature.properties?.highway || "residential";
    const highway: HighwayType = VALID_HIGHWAYS.has(rawHighway)
      ? (rawHighway as HighwayType)
      : "residential";
    const maxSpeed = parseMaxSpeed(feature.properties?.maxspeed, highway);
    const surface: string = feature.properties?.surface || "unknown";
    const onewayDir = parseOneway(feature.properties?.oneway);
    const isRoundabout = feature.properties?.junction === "roundabout";
    const effectiveOneway = isRoundabout ? "forward" : onewayDir;
    const effectiveMaxSpeed = isRoundabout ? maxSpeed * 0.5 : maxSpeed;
    const streetId: string =
      feature.properties?.streetId || feature.properties?.id || feature.properties?.["@id"] || "";
    const smoothnessFactor = parseSmoothness(feature.properties?.smoothness);
    const rawLanes = parseInt(feature.properties?.lanes ?? "1", 10);
    const lanes = isNaN(rawLanes) || rawLanes < 1 ? 1 : rawLanes;
    const capacity = lanes * 1800; // HCM: 1800 veh/hour per lane

    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];

      const id1 = makeNodeKey(lat1, lon1);
      const id2 = makeNodeKey(lat2, lon2);

      const node1 = getOrCreate(id1, lat1, lon1);
      const node2 = getOrCreate(id2, lat2, lon2);

      const distance = calculateDistance([lat1, lon1], [lat2, lon2]);

      // Forward edge (node1 → node2): skip if reverse one-way
      if (effectiveOneway !== "reverse") {
        const forwardEdgeId = `${id1}-${id2}`;
        node1.edges.push({
          id: forwardEdgeId,
          streetId,
          endNodeId: id2,
          distance,
          maxSpeed: effectiveMaxSpeed,
          surface,
          highway,
          lanes,
          capacity,
          smoothnessFactor,
        });
      }

      // Reverse edge (node2 → node1): skip if forward one-way
      if (effectiveOneway !== "forward") {
        const reverseEdgeId = `${id2}-${id1}`;
        node2.edges.push({
          id: reverseEdgeId,
          streetId,
          endNodeId: id1,
          distance,
          maxSpeed: effectiveMaxSpeed,
          surface,
          highway,
          lanes,
          capacity,
          smoothnessFactor,
        });
      }
    }
  }

  // Compute max speed across all edges for admissible heuristic
  let maxSpeed = 0;
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      if (edge.maxSpeed > maxSpeed) maxSpeed = edge.maxSpeed;
    }
  }
  _maxNetworkSpeed = maxSpeed > 0 ? maxSpeed : 110;

  // Second pass: mark traffic signal nodes
  for (const feature of data.features) {
    if (feature.geometry.type !== "Point") continue;
    const props = feature.properties ?? {};
    if (props.highway !== "traffic_signals") continue;
    const [lon, lat] = (feature.geometry as { type: "Point"; coordinates: number[] }).coordinates;
    // Find nearest node by linear scan
    let nearest: WorkerNode | null = null;
    let minDist = Infinity;
    for (const node of nodes.values()) {
      const d = calculateDistance([lat, lon], [node.lat, node.lon]);
      if (d < minDist) {
        minDist = d;
        nearest = node;
      }
    }
    if (nearest) nearest.trafficSignal = true;
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// A* implementation (mirrors RoadNetwork.findRoute)
// ---------------------------------------------------------------------------

function findRoute(
  nodes: Map<string, WorkerNode>,
  startId: string,
  endId: string,
  incidentEdges?: Record<string, number>,
  restrictedHighways?: string[],
  turnRestrictions?: Record<string, string[]>,
  turnRestrictionTypes?: Record<string, string>
): { edgeIds: string[]; distance: number } | null {
  const startNode = nodes.get(startId);
  const endNode = nodes.get(endId);
  if (!startNode || !endNode) return null;

  const closedSet = new Set<string>();
  const cameFrom = new Map<
    string,
    { prevId: string; edgeId: string; edgeDistance: number; edgeStreetId: string }
  >();
  const gScore = new Map<string, number>();

  // Min-heap
  const heap: PathNode[] = [];

  const pushHeap = (node: PathNode): void => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].fScore <= heap[i].fScore) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const popHeap = (): PathNode => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < heap.length && heap[left].fScore < heap[smallest].fScore) smallest = left;
        if (right < heap.length && heap[right].fScore < heap[smallest].fScore) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  const maxNetworkSpeed = _maxNetworkSpeed;
  const heuristic = (nodeId: string): number => {
    const n = nodes.get(nodeId)!;
    return calculateDistance([n.lat, n.lon], [endNode.lat, endNode.lon]) / maxNetworkSpeed;
  };

  gScore.set(startId, 0);
  pushHeap({ id: startId, gScore: 0, fScore: heuristic(startId) });

  while (heap.length > 0) {
    const current = popHeap();

    if (closedSet.has(current.id)) continue;

    if (current.id === endId) {
      // Reconstruct path (push + reverse is O(n) vs unshift's O(n²))
      const edgeIds: string[] = [];
      let totalDistance = 0;
      let curId = endId;
      while (curId !== startId) {
        const prev = cameFrom.get(curId)!;
        edgeIds.push(prev.edgeId);
        totalDistance += prev.edgeDistance;
        curId = prev.prevId;
      }
      edgeIds.reverse();
      return { edgeIds, distance: totalDistance };
    }

    closedSet.add(current.id);
    const currentNode = nodes.get(current.id)!;

    for (const edge of currentNode.edges) {
      if (closedSet.has(edge.endNodeId)) continue;

      // Skip edges on restricted road types for this vehicle
      if (
        restrictedHighways &&
        restrictedHighways.length > 0 &&
        restrictedHighways.includes(edge.highway)
      ) {
        continue;
      }

      // Check turn restrictions
      if (turnRestrictions) {
        const arrivalEntry = cameFrom.get(current.id);
        if (arrivalEntry) {
          const key = `${arrivalEntry.edgeStreetId}|${current.id}`;
          const restricted = turnRestrictions[key];
          if (restricted) {
            const rtype = turnRestrictionTypes?.[`${key}|type`];
            if (rtype === "prohibitory" && restricted.includes(edge.streetId)) continue;
            if (rtype === "mandatory" && !restricted.includes(edge.streetId)) continue;
          }
        }
      }

      // Apply incident-based edge cost penalties
      const incidentFactor = incidentEdges?.[edge.id];
      if (incidentFactor !== undefined && incidentFactor === 0) continue; // closure — skip edge

      // Skip impassable roads (smoothnessFactor === 0)
      if (edge.smoothnessFactor === 0) continue;

      const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
      // smoothnessFactor applied via edge.smoothnessFactor (see 9ozi.3)
      const smoothnessPenalty = 1 / ((edge.smoothnessFactor ?? 1.0) || 1.0); // avoid div-by-zero for impassable=0
      const flow = currentNode.edges.length; // proxy for observed flow (outbound edges from current node)
      const bprRatio = flow / (edge.capacity ?? 1800);
      const bprRatio2 = bprRatio * bprRatio;
      const bprCongestion = 1 + 0.15 * (bprRatio2 * bprRatio2);
      let travelTime =
        (edge.distance / edge.maxSpeed) * surfacePenalty * smoothnessPenalty * bprCongestion;
      if (incidentFactor !== undefined && incidentFactor < 1) {
        travelTime = travelTime / incidentFactor;
      }
      // Add intersection delay for signalized nodes
      const SIGNAL_DELAY_S = 45; // seconds — midpoint of 30-90s signal cycle
      const SIGNAL_DELAY_H = SIGNAL_DELAY_S / 3600;
      const endNode = nodes.get(edge.endNodeId);
      if (endNode?.trafficSignal) {
        travelTime += SIGNAL_DELAY_H;
      }
      const tentativeCost = current.gScore + travelTime;
      const existingCost = gScore.get(edge.endNodeId);

      if (existingCost === undefined || tentativeCost < existingCost) {
        cameFrom.set(edge.endNodeId, {
          prevId: current.id,
          edgeId: edge.id,
          edgeDistance: edge.distance,
          edgeStreetId: edge.streetId,
        });
        gScore.set(edge.endNodeId, tentativeCost);
        const f = tentativeCost + heuristic(edge.endNodeId);
        pushHeap({ id: edge.endNodeId, gScore: tentativeCost, fScore: f });
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Worker bootstrap
// ---------------------------------------------------------------------------

if (parentPort) {
  const geojsonPath: string = workerData.geojsonPath;
  const nodes = buildGraph(geojsonPath);

  parentPort.on(
    "message",
    (msg: {
      type: string;
      id: number;
      startId: string;
      endId: string;
      incidentEdges?: Record<string, number>;
      restrictedHighways?: string[];
      turnRestrictions?: Record<string, string[]>;
      turnRestrictionTypes?: Record<string, string>;
    }) => {
      if (msg.type === "findRoute") {
        let route = findRoute(
          nodes,
          msg.startId,
          msg.endId,
          msg.incidentEdges,
          msg.restrictedHighways,
          msg.turnRestrictions,
          msg.turnRestrictionTypes
        );
        // Fallback: if no route found with highway restrictions, retry without
        if (!route && msg.restrictedHighways && msg.restrictedHighways.length > 0) {
          route = findRoute(
            nodes,
            msg.startId,
            msg.endId,
            msg.incidentEdges,
            undefined,
            msg.turnRestrictions,
            msg.turnRestrictionTypes
          );
        }
        parentPort!.postMessage({ type: "result", id: msg.id, route });
      }
    }
  );
}

// Export for testing
export { buildGraph, findRoute, calculateDistance };
export type { WorkerNode, WorkerEdge };

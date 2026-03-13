/**
 * Worker thread for A* pathfinding on the road network.
 *
 * Receives the GeoJSON path via `workerData`, builds a lightweight adjacency
 * graph (no circular references), and processes route requests from the main
 * thread.
 *
 * Protocol:
 *   Request:  { type: 'findRoute', id: number, startId: string, endId: string }
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
  endNodeId: string;
  distance: number;
  maxSpeed: number;
  surface: string;
}

interface WorkerNode {
  id: string;
  lat: number;
  lon: number;
  edges: WorkerEdge[];
}

interface PathNode {
  id: string;
  gScore: number;
  fScore: number;
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

type HighwayType = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "residential";

const DEFAULT_SPEEDS: Record<HighwayType, number> = {
  motorway: 110,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
};

const VALID_HIGHWAYS = new Set<string>([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
]);

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

    const coords = (feature.geometry as LineString).coordinates;
    const rawHighway = feature.properties?.highway || "residential";
    const highway: HighwayType = VALID_HIGHWAYS.has(rawHighway)
      ? (rawHighway as HighwayType)
      : "residential";
    const maxSpeed = parseMaxSpeed(feature.properties?.maxspeed, highway);
    const surface: string = feature.properties?.surface || "unknown";
    const isOneway = feature.properties?.oneway === "yes";

    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];

      const id1 = `${lat1},${lon1}`;
      const id2 = `${lat2},${lon2}`;

      const node1 = getOrCreate(id1, lat1, lon1);
      const node2 = getOrCreate(id2, lat2, lon2);

      const distance = calculateDistance([lat1, lon1], [lat2, lon2]);
      const forwardEdgeId = `${id1}-${id2}`;

      node1.edges.push({
        id: forwardEdgeId,
        endNodeId: id2,
        distance,
        maxSpeed,
        surface,
      });

      if (!isOneway) {
        const reverseEdgeId = `${id2}-${id1}`;
        node2.edges.push({
          id: reverseEdgeId,
          endNodeId: id1,
          distance,
          maxSpeed,
          surface,
        });
      }
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// A* implementation (mirrors RoadNetwork.findRoute)
// ---------------------------------------------------------------------------

function findRoute(
  nodes: Map<string, WorkerNode>,
  startId: string,
  endId: string
): { edgeIds: string[]; distance: number } | null {
  const startNode = nodes.get(startId);
  const endNode = nodes.get(endId);
  if (!startNode || !endNode) return null;

  const closedSet = new Set<string>();
  const cameFrom = new Map<string, { prevId: string; edgeId: string; edgeDistance: number }>();
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

  const heuristic = (nodeId: string): number => {
    const n = nodes.get(nodeId)!;
    return calculateDistance([n.lat, n.lon], [endNode.lat, endNode.lon]) / 110;
  };

  gScore.set(startId, 0);
  pushHeap({ id: startId, gScore: 0, fScore: heuristic(startId) });

  while (heap.length > 0) {
    const current = popHeap();

    if (closedSet.has(current.id)) continue;

    if (current.id === endId) {
      // Reconstruct path
      const edgeIds: string[] = [];
      let totalDistance = 0;
      let curId = endId;
      while (curId !== startId) {
        const prev = cameFrom.get(curId)!;
        edgeIds.unshift(prev.edgeId);
        totalDistance += prev.edgeDistance;
        curId = prev.prevId;
      }
      return { edgeIds, distance: totalDistance };
    }

    closedSet.add(current.id);
    const currentNode = nodes.get(current.id)!;

    for (const edge of currentNode.edges) {
      if (closedSet.has(edge.endNodeId)) continue;

      const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
      const travelTime = (edge.distance / edge.maxSpeed) * surfacePenalty;
      const tentativeCost = current.gScore + travelTime;
      const existingCost = gScore.get(edge.endNodeId);

      if (existingCost === undefined || tentativeCost < existingCost) {
        cameFrom.set(edge.endNodeId, {
          prevId: current.id,
          edgeId: edge.id,
          edgeDistance: edge.distance,
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

  parentPort.on("message", (msg: { type: string; id: number; startId: string; endId: string }) => {
    if (msg.type === "findRoute") {
      const route = findRoute(nodes, msg.startId, msg.endId);
      parentPort!.postMessage({ type: "result", id: msg.id, route });
    }
  });
}

// Export for testing
export { buildGraph, findRoute, calculateDistance };
export type { WorkerNode, WorkerEdge };

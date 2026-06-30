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
 *
 * This worker no longer hand-duplicates the A* cost function, the binary heap or
 * the OSM-tag parsers: it imports them from the same canonical modules the
 * main-thread RoadNetwork uses (`../modules/pathfinding/{cost,heap}` and
 * `../modules/roadnetwork/types`). Those imports use extensionless ESM specifiers
 * that plain Node cannot resolve when this file is launched directly via
 * `new Worker(...)`, so the worker is pre-bundled into a self-contained
 * `dist/workers/pathfinding-worker.cjs` at build time (esbuild) and the
 * PathfindingPool launches that bundle. Under vitest the equivalence test imports
 * this module in-process (vitest transforms the TS + its relative imports), so
 * the same shared code is exercised both ways. The only logic still local to the
 * worker is the GeoJSON-to-adjacency parse and the A* loop itself: the parse
 * builds a flat, non-circular node/edge shape that differs from GraphBuilder's
 * circular `Edge` objects, so sharing it is not worth the entanglement (see the
 * deferred note in apps/simulator/CLAUDE.md).
 */

import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import type { FeatureCollection, LineString } from "geojson";
import { computeBaseTravelTime, applyDynamicCost } from "../modules/pathfinding/cost";
import { PathNodeHeap } from "../modules/pathfinding/heap";
import {
  parseSmoothness,
  parseMaxSpeed,
  parseOneway,
  VALID_HIGHWAYS,
} from "../modules/roadnetwork/types";
import type { HighwayType } from "../types";

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
  /** Precomputed static base travel time (hours); set after the graph is built. */
  baseTravelTime: number;
}

interface WorkerNode {
  id: string;
  lat: number;
  lon: number;
  edges: WorkerEdge[];
  trafficSignal?: boolean;
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

// Module-level max network speed for admissible heuristic (set by buildGraph)
let _maxNetworkSpeed = 110;

// Coordinate snapping to deduplicate near-identical intersection nodes
const COORD_SNAP_EPSILON = 1e-7;

function snapCoord(val: number): string {
  return (Math.round(val / COORD_SNAP_EPSILON) * COORD_SNAP_EPSILON).toFixed(7);
}

function makeNodeKey(lat: number, lon: number): string {
  return `${snapCoord(lat)},${snapCoord(lon)}`;
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
          baseTravelTime: 0, // filled in after the graph is fully built
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
          baseTravelTime: 0, // filled in after the graph is fully built
        });
      }
    }
  }

  // Compute max speed across all edges for admissible heuristic, and precompute
  // each edge's static base travel time now that every node's outbound-edge
  // count (the BPR flow proxy) is final. `node.edges.length` here is the start
  // node's outbound count — identical to the main thread's flow proxy.
  let maxSpeed = 0;
  for (const node of nodes.values()) {
    const flow = node.edges.length;
    for (const edge of node.edges) {
      if (edge.maxSpeed > maxSpeed) maxSpeed = edge.maxSpeed;
      edge.baseTravelTime = computeBaseTravelTime(edge, flow);
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

  // Shared binary min-heap (identical to the main-thread A*); see the module
  // header for why this worker is bundled rather than launched as raw TS.
  const heap = new PathNodeHeap();

  const maxNetworkSpeed = _maxNetworkSpeed;
  const heuristic = (nodeId: string): number => {
    const n = nodes.get(nodeId)!;
    return calculateDistance([n.lat, n.lon], [endNode.lat, endNode.lon]) / maxNetworkSpeed;
  };

  gScore.set(startId, 0);
  heap.push({ id: startId, gScore: 0, fScore: heuristic(startId) });

  while (heap.size > 0) {
    const current = heap.pop();

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

      // Static base cost was precomputed at graph-build time; only the dynamic
      // incident/signal terms are applied here in the hot relaxation loop.
      const endNode = nodes.get(edge.endNodeId);
      const travelTime = applyDynamicCost(
        edge.baseTravelTime,
        incidentFactor,
        endNode?.trafficSignal === true
      );
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
        heap.push({ id: edge.endNodeId, gScore: tentativeCost, fScore: f });
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

// Export for testing. computeBaseTravelTime/applyDynamicCost are re-exported from
// the shared cost module so the equivalence test can assert the worker uses the
// exact same canonical functions as the main thread (they are now the same
// reference, not a hand-synced copy).
export { buildGraph, findRoute, calculateDistance, computeBaseTravelTime, applyDynamicCost };
export type { WorkerNode, WorkerEdge };

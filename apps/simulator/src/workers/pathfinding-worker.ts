/**
 * Worker thread for A* pathfinding on the road network.
 *
 * Receives its bootstrap settings via `workerData` (see
 * {@link PathfindingWorkerData}), builds a lightweight adjacency graph (no
 * circular references), and processes route requests from the main thread.
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
 *
 * The A* heuristic is ALT (landmarks + triangle inequality) with the original
 * haversine bound as a floor; the preprocessing itself is shared with the main
 * thread via `../modules/pathfinding/landmarks`. The landmark COUNT arrives in
 * `workerData` (parsed from `PATHFINDING_LANDMARKS` by the zod schema on the
 * main thread — the bundle must not import that module), but the tables
 * themselves are recomputed here from the same GeoJSON. Selection is
 * deterministic, so all copies are identical — but they are also duplicated per
 * worker (see the memory note in apps/simulator/CLAUDE.md).
 */

import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import type { FeatureCollection, LineString } from "geojson";
import {
  computeBaseTravelTime,
  applyDynamicCost,
  mergeNodeControl,
  nodeDelayHours,
  TRAFFIC_CALMING_MAX_SPEED_KMH,
  type NodeControl,
} from "../modules/pathfinding/cost";
import { PathNodeHeap } from "../modules/pathfinding/heap";
import {
  AltHeuristic,
  type LandmarkIndex,
  DEFAULT_LANDMARK_COUNT,
  buildCsrPair,
  buildLandmarkIndex,
  sortedNodeIds,
} from "../modules/pathfinding/landmarks";
import {
  parseSmoothness,
  resolveMaxSpeed,
  parseOneway,
  parseNodeControls,
  DEFAULT_FREE_FLOW_FACTORS,
  VALID_HIGHWAYS,
} from "../modules/roadnetwork/types";
import type { HighwayType } from "../types";

// ---------------------------------------------------------------------------
// Bootstrap contract
// ---------------------------------------------------------------------------

/**
 * Everything `PathfindingPool` hands a worker at spawn time.
 *
 * This is the ONLY channel by which configuration reaches a worker: the bundle
 * must stay free of the zod/dotenv/pino config module (see the header above and
 * `scripts/build-worker.mjs`), so `PathfindingPool` resolves settings on the
 * main thread and passes the resolved values here. `PathfindingPool` imports
 * this interface as a type, which erases at build time and cannot pull the pool
 * (and its logger) into the worker bundle.
 */
export interface PathfindingWorkerData {
  /** Path to the GeoJSON road network the worker builds its graph from. */
  geojsonPath: string;
  /**
   * ALT landmarks to precompute, already parsed and clamped from
   * `PATHFINDING_LANDMARKS` by the zod schema in `utils/config.ts`. `0`
   * disables preprocessing and restores the pure-haversine heuristic.
   */
  landmarkCount?: number;
  /** Per-highway-class free-flow factors, already parsed from `FREE_FLOW_FACTORS`. */
  freeFlowFactors?: Record<HighwayType, number>;
}

// ---------------------------------------------------------------------------
// Lightweight graph types (no circular refs)
// ---------------------------------------------------------------------------

interface WorkerEdge {
  id: string;
  streetId: string;
  endNodeId: string;
  distance: number;
  maxSpeed: number;
  freeFlowSpeed: number;
  surface: string;
  highway: string;
  lanes: number;
  capacity: number;
  smoothnessFactor: number;
  /** Precomputed static base travel time (hours); set after the graph is built. */
  baseTravelTime: number;
  /** Precomputed node-control delay (hours) for arriving via this edge; 0 when none. */
  nodeDelayH: number;
}

interface WorkerNode {
  id: string;
  lat: number;
  lon: number;
  edges: WorkerEdge[];
  trafficSignal?: boolean;
  /**
   * Index into the ALT landmark distance tables, assigned in sorted-node-id
   * order so it matches the main thread's assignment for the same GeoJSON.
   * -1 when landmark preprocessing is disabled.
   */
  altIndex: number;
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

// Module-level max network speed for admissible heuristic (set by buildGraph)
let _maxNetworkSpeed = 110;

/**
 * Module-level ALT heuristic (set by buildGraph), following the same pattern as
 * `_maxNetworkSpeed`: a worker builds exactly one graph for its lifetime. Null
 * when landmarks are disabled, in which case the A* below uses the previous
 * pure-haversine bound.
 *
 * The worker computes its OWN landmark tables rather than receiving them from
 * the main thread: `PathfindingPool` passes workers nothing but `{ geojsonPath }`.
 * Selection is deterministic (sorted node ids + lowest-index tie-breaks), so
 * every worker and the main thread independently pick the same landmarks and
 * therefore run the identical search.
 */
let _alt: AltHeuristic | null = null;
/** Nodes expanded by the most recent `findRoute` call (non-stale heap pops). */
let _lastExpandedNodes = 0;

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

function buildGraph(
  geojsonPath: string,
  landmarkCount: number = DEFAULT_LANDMARK_COUNT,
  freeFlowFactors: Readonly<Record<HighwayType, number>> = DEFAULT_FREE_FLOW_FACTORS
): Map<string, WorkerNode> {
  const data: FeatureCollection = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const nodes = new Map<string, WorkerNode>();

  function getOrCreate(id: string, lat: number, lon: number): WorkerNode {
    let node = nodes.get(id);
    if (!node) {
      node = { id, lat, lon, edges: [], altIndex: -1 };
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
    const freeFlowFactor = freeFlowFactors[highway];
    const surface: string = feature.properties?.surface || "unknown";
    const onewayDir = parseOneway(feature.properties?.oneway);
    const isRoundabout = feature.properties?.junction === "roundabout";
    const effectiveOneway = isRoundabout ? "forward" : onewayDir;
    const roundaboutFactor = isRoundabout ? 0.5 : 1;
    const forwardSpeed = resolveMaxSpeed(feature.properties, highway, "forward") * roundaboutFactor;
    const backwardSpeed =
      resolveMaxSpeed(feature.properties, highway, "backward") * roundaboutFactor;
    const streetId: string =
      feature.properties?.streetId || feature.properties?.id || feature.properties?.["@id"] || "";
    const smoothnessFactor = parseSmoothness(feature.properties?.smoothness);
    const rawLanes = parseInt(feature.properties?.lanes ?? "1", 10);
    const lanes = isNaN(rawLanes) || rawLanes < 1 ? 1 : rawLanes;
    const capacity = lanes * 1800; // HCM: 1800 veh/hour per lane

    // A way-level traffic_calming tag caps the free-flow speed for the whole
    // segment (mirrors GraphBuilder.ts — see cost.ts for why this is a speed
    // cap rather than a node delay).
    const wayCalming = feature.properties?.traffic_calming;
    const calmingSpeedCap =
      wayCalming && wayCalming !== "no" ? TRAFFIC_CALMING_MAX_SPEED_KMH : Infinity;

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
          maxSpeed: forwardSpeed,
          freeFlowSpeed: Math.min(forwardSpeed * freeFlowFactor, calmingSpeedCap),
          surface,
          highway,
          lanes,
          capacity,
          smoothnessFactor,
          baseTravelTime: 0, // filled in after the graph is fully built
          nodeDelayH: 0, // filled in after node controls are collected
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
          maxSpeed: backwardSpeed,
          freeFlowSpeed: Math.min(backwardSpeed * freeFlowFactor, calmingSpeedCap),
          surface,
          highway,
          lanes,
          capacity,
          smoothnessFactor,
          baseTravelTime: 0, // filled in after the graph is fully built
          nodeDelayH: 0, // filled in after node controls are collected
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
      if (edge.freeFlowSpeed > maxSpeed) maxSpeed = edge.freeFlowSpeed;
      edge.baseTravelTime = computeBaseTravelTime(edge, flow);
    }
  }
  _maxNetworkSpeed = maxSpeed > 0 ? maxSpeed : 110;

  // Second pass: mark traffic signal nodes and collect node controls (stop,
  // give-way, crossings, level crossings, point traffic-calming) — mirrors
  // GraphBuilder.ts's third pass so both sides derive identical delays.
  const nodeControls = new Map<string, NodeControl>();
  for (const feature of data.features) {
    if (feature.geometry.type !== "Point") continue;
    const props = feature.properties ?? {};
    const controls = parseNodeControls(props);
    if (controls.length === 0) continue;

    const [lon, lat] = (feature.geometry as { type: "Point"; coordinates: number[] }).coordinates;
    const nearest = findControlNode(nodes, lat, lon);
    if (!nearest) continue;

    for (const control of controls) {
      if (control.kind === "traffic_signals") nearest.trafficSignal = true;
      nodeControls.set(nearest.id, mergeNodeControl(nodeControls.get(nearest.id), control));
    }
  }

  // Third pass: precompute each edge's node-control delay now that every
  // node's control (if any) is known. Depends on the APPROACH edge's own
  // highway class, so it lives on the edge rather than the node (see cost.ts).
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      edge.nodeDelayH = nodeDelayHours(
        nodeControls.get(edge.endNodeId),
        edge.highway as HighwayType
      );
    }
  }

  // ALT landmark preprocessing over the static base costs (see
  // ../modules/pathfinding/landmarks.ts for the admissibility argument).
  _alt = buildWorkerLandmarks(nodes, landmarkCount);

  return nodes;
}

/**
 * Resolves a Point feature's coordinate to a graph node — mirrors
 * `GraphBuilder.findControlNode`: an exact snapped-key lookup handles the vast
 * majority of control points in O(1) (they share a coordinate with a way
 * vertex), falling back to a linear scan only when that misses.
 */
function findControlNode(
  nodes: Map<string, WorkerNode>,
  lat: number,
  lon: number
): WorkerNode | null {
  const exact = nodes.get(makeNodeKey(lat, lon));
  if (exact) return exact;
  let nearest: WorkerNode | null = null;
  let minDist = Infinity;
  for (const node of nodes.values()) {
    const d = calculateDistance([lat, lon], [node.lat, node.lon]);
    if (d < minDist) {
      minDist = d;
      nearest = node;
    }
  }
  return nearest;
}

/**
 * Assigns sorted-order ALT indices to `nodes`, builds the transient
 * forward/reverse CSR adjacency over the precomputed base travel times, and
 * runs the landmark Dijkstras.
 *
 * Mirrors `GraphBuilder.buildLandmarks` — same index order, same edge filter
 * (`smoothnessFactor === 0` excluded, exactly as the A* loop excludes them),
 * same selection — so both sides derive identical tables from identical GeoJSON.
 */
function buildWorkerLandmarks(
  nodes: Map<string, WorkerNode>,
  requested: number
): AltHeuristic | null {
  const nodeCount = nodes.size;
  if (requested <= 0 || nodeCount === 0) return null;

  // Stamp the index onto the nodes themselves; the CSR pass then resolves an
  // edge's target through the existing node map instead of a second side table.
  const order = sortedNodeIds(nodes.keys());
  for (let i = 0; i < order.length; i++) {
    nodes.get(order[i])!.altIndex = i;
  }

  let capacity = 0;
  for (const node of nodes.values()) capacity += node.edges.length;

  const from = new Int32Array(capacity);
  const to = new Int32Array(capacity);
  const weight = new Float64Array(capacity);
  let edgeCount = 0;
  for (const node of nodes.values()) {
    const sourceIndex = node.altIndex;
    for (const edge of node.edges) {
      if (edge.smoothnessFactor === 0) continue;
      const target = nodes.get(edge.endNodeId);
      if (target === undefined) continue;
      from[edgeCount] = sourceIndex;
      to[edgeCount] = target.altIndex;
      weight[edgeCount] = edge.baseTravelTime;
      edgeCount++;
    }
  }

  const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, edgeCount);
  const index: LandmarkIndex | null = buildLandmarkIndex(forward, reverse, requested);
  return index ? new AltHeuristic(index) : null;
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
    {
      prevId: string;
      edgeId: string;
      edgeDistance: number;
      edgeStreetId: string;
    }
  >();
  const gScore = new Map<string, number>();

  // Shared binary min-heap (identical to the main-thread A*); see the module
  // header for why this worker is bundled rather than launched as raw TS.
  const heap = new PathNodeHeap();

  const maxNetworkSpeed = _maxNetworkSpeed;
  // Pin the ALT heuristic to this target; falls back to pure haversine when
  // landmarks are disabled or no landmark bounds the target.
  const alt = _alt;
  const altActive = alt ? alt.setTarget(endNode.altIndex) : false;
  const heuristic = (nodeId: string): number => {
    const n = nodes.get(nodeId)!;
    const geographic =
      calculateDistance([n.lat, n.lon], [endNode.lat, endNode.lon]) / maxNetworkSpeed;
    if (!altActive) return geographic;
    // max of two admissible+consistent bounds is admissible+consistent.
    const landmark = alt!.bound(n.altIndex);
    return landmark > geographic ? landmark : geographic;
  };

  gScore.set(startId, 0);
  heap.push({ id: startId, gScore: 0, fScore: heuristic(startId) });
  _lastExpandedNodes = 0;

  while (heap.size > 0) {
    const current = heap.pop();

    if (closedSet.has(current.id)) continue;
    _lastExpandedNodes++;

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

      // Static base cost and the node-control delay were both precomputed at
      // graph-build time; only the dynamic incident term is derived here in
      // the hot relaxation loop.
      const travelTime = applyDynamicCost(edge.baseTravelTime, incidentFactor, edge.nodeDelayH);
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
  const { geojsonPath, landmarkCount, freeFlowFactors } = workerData as PathfindingWorkerData;
  const nodes = buildGraph(geojsonPath, landmarkCount, freeFlowFactors);

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

/** Nodes expanded by the most recent `findRoute` call. Test/benchmark hook. */
export function lastExpandedNodes(): number {
  return _lastExpandedNodes;
}

/** The ALT heuristic built by the last `buildGraph` call, if any. Test hook. */
export function landmarkHeuristic(): AltHeuristic | null {
  return _alt;
}

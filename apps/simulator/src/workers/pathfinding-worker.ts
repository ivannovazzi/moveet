/**
 * Worker thread for A* pathfinding on the road network.
 *
 * Receives its bootstrap settings via `workerData` (see
 * {@link PathfindingWorkerData}), builds a lightweight adjacency graph (no
 * circular references), and processes route requests from the main thread.
 *
 * Protocol:
 *   Request:  { type: 'findRoute', id: number, startId: string, endId: string, incidentEdges?: Record<string, number>, restrictedHighways?: string[], arrival?: { edgeId: string, startId: string } }
 *   Response: { type: 'result',    id: number, route: { edgeIds: string[], distance: number } | null }
 *   Table:    { type: 'speedProfile', indices: Int32Array, speeds: Float32Array }  (no response;
 *             replaces the learned-speed table used by every later request, see applySpeedOverrides)
 *   Weather:  { type: 'weather', factor: number }  (no response; replaces the global weather speed
 *             factor used by every later request, see applyWeatherFactor — fleetsim-all-1ajn.5)
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
 * the same shared code is exercised both ways. The turn model (penalties, OSM
 * restriction parsing and resolution to edge bans) is shared the same way via
 * `../modules/pathfinding/turns`. The only logic still local to the
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
  clampLearnedSpeed,
  clampWeatherFactor,
  landmarkLowerBoundCost,
  mergeNodeControl,
  nodeDelayHours,
  TRAFFIC_CALMING_MAX_SPEED_KMH,
  type NodeControl,
} from "../modules/pathfinding/cost";
import { EdgeSearchScratch } from "../modules/pathfinding/search";
import {
  DEFAULT_DRIVE_SIDE,
  bearingDegrees,
  isUTurnAllowed,
  parseTurnRestriction,
  resolveTurnBans,
  turnCostHours,
  type DriveSide,
  type TurnGraphEdge,
  type TurnNodeContext,
  type TurnRestriction,
} from "../modules/pathfinding/turns";
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
  MAX_CONTROL_SNAP_KM,
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
  /** Drive side for turn penalties, already parsed from `DRIVE_SIDE`. */
  driveSide?: DriveSide;
  /**
   * `SPEED_PROFILE_MAX_SPEED_RATIO` when learned speed profiles are enabled,
   * null/absent when disabled. Shapes the landmark tables exactly as on the main
   * thread; the tables themselves arrive later as `speedProfile` messages.
   */
  speedProfileRatio?: number | null;
}

// ---------------------------------------------------------------------------
// Lightweight graph types (no circular refs)
// ---------------------------------------------------------------------------

interface WorkerEdge {
  id: string;
  streetId: string;
  startNodeId: string;
  endNodeId: string;
  /** The end node itself, so the hot loop needs no id lookup. */
  endNode: WorkerNode;
  /** Dense index into the search scratch (insertion order, as on the main thread). */
  index: number;
  distance: number;
  /** Bearing in degrees, computed exactly as GraphBuilder does (reverse = forward + 180). */
  bearing: number;
  /** Mirrors `Edge.oneway`: the way carries no oncoming traffic. */
  oneway: boolean;
  maxSpeed: number;
  freeFlowSpeed: number;
  surface: string;
  highway: string;
  lanes: number;
  capacity: number;
  smoothnessFactor: number;
  /**
   * Base travel time (hours) the search charges: the precomputed static cost,
   * or the learned-speed cost while the edge is in the active speed table (see
   * {@link applySpeedOverrides}).
   */
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
  /** Distinct neighbouring nodes (in or out); mirrors `Node.degree`. */
  degree: number;
  /** Dense index into the search scratch's per-node heuristic cache. */
  index: number;
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
/** Turn bans resolved by buildGraph: arriving edge id -> banned next edge ids. */
let _turnBans = new Map<string, Set<string>>();
/** Drive side for turn penalties (set by buildGraph from workerData). */
let _driveSide: DriveSide = DEFAULT_DRIVE_SIDE;
/** Learned speed profile ratio, or null when profiles are disabled (set by buildGraph). */
let _speedProfileRatio: number | null = null;
/**
 * Global weather speed factor (fleetsim-all-1ajn.5), `(0, 1]`, 1 = no effect —
 * mirrors `PathfindingEngine.weatherFactor`. Set by a `weather` message
 * ({@link applyWeatherFactor}), persists across requests like the learned-speed
 * table (unlike incidents, which arrive per request).
 */
let _weatherFactor = 1;

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
  freeFlowFactors: Readonly<Record<HighwayType, number>> = DEFAULT_FREE_FLOW_FACTORS,
  driveSide: DriveSide = DEFAULT_DRIVE_SIDE,
  speedProfileRatio: number | null = null
): Map<string, WorkerNode> {
  _driveSide = driveSide;
  _speedProfileRatio = speedProfileRatio;
  const data: FeatureCollection = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const nodes = new Map<string, WorkerNode>();

  function getOrCreate(id: string, lat: number, lon: number): WorkerNode {
    let node = nodes.get(id);
    if (!node) {
      node = { id, lat, lon, edges: [], degree: 0, index: -1, altIndex: -1 };
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
    // Stringified like GraphBuilder's, so OSM way ids match restriction from/to.
    const streetId = String(
      feature.properties?.streetId || feature.properties?.id || feature.properties?.["@id"] || ""
    );
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
      const bearing = bearingDegrees([lat1, lon1], [lat2, lon2]);

      // Forward edge (node1 → node2): skip if reverse one-way
      if (effectiveOneway !== "reverse") {
        const forwardEdgeId = `${id1}-${id2}`;
        node1.edges.push({
          id: forwardEdgeId,
          streetId,
          startNodeId: id1,
          endNodeId: id2,
          endNode: node2,
          index: -1, // assigned once the graph is complete
          distance,
          bearing,
          oneway: effectiveOneway === "forward",
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
          startNodeId: id2,
          endNodeId: id1,
          endNode: node1,
          index: -1, // assigned once the graph is complete
          distance,
          bearing: (bearing + 180) % 360,
          oneway: effectiveOneway === "reverse",
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
  // Scaled like GraphBuilder's: a learned speed may reach freeFlowSpeed × ratio.
  _maxNetworkSpeed = (maxSpeed > 0 ? maxSpeed : 110) * (speedProfileRatio ?? 1);

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

  // Fourth pass: search indices, node degrees and turn bans — mirrors
  // PathfindingEngine's indexing and GraphBuilder's stampNodeDegrees /
  // buildTurnBans.
  let nodeIndex = 0;
  let edgeIndex = 0;
  for (const node of nodes.values()) {
    node.index = nodeIndex++;
    for (const edge of node.edges) edge.index = edgeIndex++;
  }
  stampWorkerNodeDegrees(nodes);
  const restrictions: TurnRestriction[] = [];
  for (const feature of data.features) {
    const parsed = parseTurnRestriction(feature.properties ?? {}, feature.geometry, makeNodeKey);
    if (parsed) restrictions.push(parsed);
  }
  _turnBans = buildWorkerTurnBans(nodes, restrictions);

  // ALT landmark preprocessing over the static base costs (see
  // ../modules/pathfinding/landmarks.ts for the admissibility argument).
  _alt = buildWorkerLandmarks(nodes, landmarkCount, speedProfileRatio);

  return nodes;
}

/** Mirrors `GraphBuilder.stampNodeDegrees`: distinct neighbours, in or out. */
function stampWorkerNodeDegrees(nodes: Map<string, WorkerNode>): void {
  for (const node of nodes.values()) {
    const seen: string[] = [];
    for (const edge of node.edges) {
      if (!seen.includes(edge.endNodeId)) seen.push(edge.endNodeId);
    }
    node.degree = seen.length;
  }
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      const end = nodes.get(edge.endNodeId)!;
      if (!end.edges.some((e) => e.endNodeId === edge.startNodeId)) end.degree++;
    }
  }
}

/** Mirrors `GraphBuilder.buildTurnBans`. */
function buildWorkerTurnBans(
  nodes: Map<string, WorkerNode>,
  restrictions: TurnRestriction[]
): Map<string, Set<string>> {
  if (restrictions.length === 0) return new Map();
  const viaIds = new Set(restrictions.map((r) => r.via));
  const incoming = new Map<string, TurnGraphEdge[]>();
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      if (!viaIds.has(edge.endNodeId)) continue;
      let list = incoming.get(edge.endNodeId);
      if (!list) {
        list = [];
        incoming.set(edge.endNodeId, list);
      }
      list.push(edge);
    }
  }
  return resolveTurnBans(
    restrictions,
    (id) => incoming.get(id) ?? [],
    (id) => nodes.get(id)?.edges ?? []
  );
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
  return minDist <= MAX_CONTROL_SNAP_KM ? nearest : null;
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
  requested: number,
  speedProfileRatio: number | null
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
      // + the static node-control delay, exactly as GraphBuilder.buildLandmarks.
      weight[edgeCount] =
        landmarkLowerBoundCost(
          edge.baseTravelTime,
          edge.distance,
          edge.freeFlowSpeed,
          speedProfileRatio
        ) + edge.nodeDelayH;
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

/** Travel time with incident/node-control terms, or -1 when the edge is unusable. */
function dynamicEdgeCost(
  edge: WorkerEdge,
  incidentEdges: Record<string, number> | undefined,
  restrictedHighways: string[] | undefined
): number {
  // Skip edges on restricted road types for this vehicle
  if (
    restrictedHighways &&
    restrictedHighways.length > 0 &&
    restrictedHighways.includes(edge.highway)
  ) {
    return -1;
  }

  // Apply incident-based edge cost penalties
  const incidentFactor = incidentEdges?.[edge.id];
  if (incidentFactor !== undefined && incidentFactor === 0) return -1; // closure — skip edge

  // Skip impassable roads (smoothnessFactor === 0)
  if (edge.smoothnessFactor === 0) return -1;

  // Static base cost and the node-control delay were both precomputed at
  // graph-build time; only the dynamic incident/weather terms are derived
  // here in the hot relaxation loop.
  return applyDynamicCost(edge.baseTravelTime, incidentFactor, edge.nodeDelayH, _weatherFactor);
}

/** The edge a moving vehicle arrives at the start node on (see `findRoute`). */
interface WorkerArrival {
  edgeId: string;
  /** The arrival edge's start node id, where it is found in O(degree). */
  startId: string;
}

/**
 * Edge-based A* (state = arriving edge), mirroring `PathfindingEngine.findRoute`
 * step for step — same seeding, same turn costs/bans, same push order — so the
 * two return identical routes.
 */
function findRoute(
  nodes: Map<string, WorkerNode>,
  startId: string,
  endId: string,
  incidentEdges?: Record<string, number>,
  restrictedHighways?: string[],
  arrival?: WorkerArrival
): { edgeIds: string[]; distance: number } | null {
  const startNode = nodes.get(startId);
  const endNode = nodes.get(endId);
  if (!startNode || !endNode) return null;
  // The arriving edge is found among its start node's outgoing edges; one that
  // does not exist or does not end at the start node leaves the search
  // unconstrained (mirrors `PathfindingEngine.validArrival`).
  const from = arrival?.edgeId
    ? nodes
        .get(arrival.startId)
        ?.edges.find((e) => e.id === arrival.edgeId && e.endNodeId === startId)
    : undefined;

  _lastExpandedNodes = 0;
  if (startId === endId) return { edgeIds: [], distance: 0 };

  // Typed-array state indexed by edge/node `index` (see pathfinding/search.ts).
  const { scratch, edges } = scratchFor(nodes);
  const search = scratch.begin();
  const { g, gStamp, closedStamp, prev, h, hStamp, heap } = scratch;

  const maxNetworkSpeed = _maxNetworkSpeed;
  const turnBans = _turnBans;
  const driveSide = _driveSide;
  // Pin the ALT heuristic to this target; falls back to pure haversine when
  // landmarks are disabled or no landmark bounds the target.
  const alt = _alt;
  const altActive = alt ? alt.setTarget(endNode.altIndex) : false;
  // Memoized per node for this search.
  const heuristic = (n: WorkerNode): number => {
    if (hStamp[n.index] === search) return h[n.index];
    let bound = calculateDistance([n.lat, n.lon], [endNode.lat, endNode.lon]) / maxNetworkSpeed;
    if (altActive) {
      // max of two admissible+consistent bounds is admissible+consistent.
      const landmark = alt!.bound(n.altIndex);
      if (landmark > bound) bound = landmark;
    }
    hStamp[n.index] = search;
    h[n.index] = bound;
    return bound;
  };

  // Seed with every usable edge out of the start node: no turn charged unless
  // an arrival edge is given, in which case its bans / U-turn rule / turn cost
  // apply exactly as in the relaxation loop (mirrors PathfindingEngine).
  const seedBans = from && turnBans.size > 0 ? turnBans.get(from.id) : undefined;
  const startTurn: TurnNodeContext = {
    degree: startNode.degree,
    signalized: startNode.trafficSignal === true,
  };
  for (const edge of startNode.edges) {
    const i = edge.index;
    let turn = 0;
    if (from) {
      if (seedBans?.has(edge.id)) continue;
      const isUTurn = edge.endNodeId === from.startNodeId;
      if (isUTurn && !isUTurnAllowed(startTurn.degree, startNode.edges.length)) continue;
      turn = turnCostHours(from.bearing, edge.bearing, isUTurn, !from.oneway, startTurn, driveSide);
    }
    const travelTime = dynamicEdgeCost(edge, incidentEdges, restrictedHighways);
    if (travelTime < 0) continue;
    const cost = travelTime + turn;
    if (gStamp[i] === search && g[i] <= cost) continue;
    gStamp[i] = search;
    g[i] = cost;
    prev[i] = -1;
    heap.push(i, cost + heuristic(edge.endNode));
  }

  while (heap.size > 0) {
    const current = heap.pop();

    // Lazy deletion: skip stale duplicates of an already-expanded edge.
    if (closedStamp[current] === search) continue;
    _lastExpandedNodes++;

    const arrival = edges[current];
    if (arrival.endNodeId === endId) {
      // Reconstruct path (push + reverse is O(n) vs unshift's O(n²))
      const edgeIds: string[] = [];
      let totalDistance = 0;
      for (let i = current; i !== -1; i = prev[i]) {
        edgeIds.push(edges[i].id);
        totalDistance += edges[i].distance;
      }
      edgeIds.reverse();
      return { edgeIds, distance: totalDistance };
    }

    closedStamp[current] = search;
    const gCurrent = g[current];
    const node = arrival.endNode;

    const bans = turnBans.size > 0 ? turnBans.get(arrival.id) : undefined;
    const turnNode: TurnNodeContext = {
      degree: node.degree,
      signalized: node.trafficSignal === true,
    };
    const inTwoWay = !arrival.oneway;

    for (const edge of node.edges) {
      const j = edge.index;
      if (closedStamp[j] === search) continue;
      // OSM turn restriction resolved to this exact (arrival, edge) pair.
      if (bans !== undefined && bans.has(edge.id)) continue;
      const isUTurn = edge.endNodeId === arrival.startNodeId;
      if (isUTurn && !isUTurnAllowed(turnNode.degree, node.edges.length)) continue;

      const travelTime = dynamicEdgeCost(edge, incidentEdges, restrictedHighways);
      if (travelTime < 0) continue;

      const tentativeCost =
        gCurrent +
        travelTime +
        turnCostHours(arrival.bearing, edge.bearing, isUTurn, inTwoWay, turnNode, driveSide);

      if (gStamp[j] !== search || tentativeCost < g[j]) {
        gStamp[j] = search;
        g[j] = tentativeCost;
        prev[j] = current;
        heap.push(j, tentativeCost + heuristic(edge.endNode));
      }
    }
  }

  return null;
}

/**
 * Per-graph search scratch, created on first use. Keyed by the node map rather
 * than held module-level because tests build several graphs in one process.
 */
interface ScratchEntry {
  scratch: EdgeSearchScratch;
  edges: WorkerEdge[];
  /** Edge indices priced at a learned speed by the active table. */
  overridden: Int32Array;
}

const _scratches = new WeakMap<Map<string, WorkerNode>, ScratchEntry>();

function scratchFor(nodes: Map<string, WorkerNode>): ScratchEntry {
  let entry = _scratches.get(nodes);
  if (!entry) {
    const edges: WorkerEdge[] = [];
    for (const node of nodes.values()) {
      for (const edge of node.edges) edges[edge.index] = edge;
    }
    entry = {
      scratch: new EdgeSearchScratch(edges.length, nodes.size),
      edges,
      overridden: new Int32Array(0),
    };
    _scratches.set(nodes, entry);
  }
  return entry;
}

/**
 * Replaces the active learned-speed table — mirrors
 * `PathfindingEngine.setSpeedOverrides`: listed edges are priced at their
 * clamped learned speed, edges of the previous table are restored to their
 * static cost (recomputed with the same shared function and flow proxy, so the
 * value is bit-identical to the build-time one). A no-op when profiles are
 * disabled for this graph.
 */
function applySpeedOverrides(
  nodes: Map<string, WorkerNode>,
  table: { indices: ArrayLike<number>; speeds: ArrayLike<number> }
): void {
  const ratio = _speedProfileRatio;
  if (ratio === null) return;
  const entry = scratchFor(nodes);
  const edges = entry.edges;
  for (const i of entry.overridden) {
    const edge = edges[i];
    edge.baseTravelTime = computeBaseTravelTime(edge, nodes.get(edge.startNodeId)!.edges.length);
  }
  const applied: number[] = [];
  for (let k = 0; k < table.indices.length; k++) {
    const i = table.indices[k];
    const edge = edges[i];
    if (!edge || !(table.speeds[k] > 0)) continue;
    edge.baseTravelTime =
      edge.distance / clampLearnedSpeed(table.speeds[k], edge.freeFlowSpeed, ratio);
    applied.push(i);
  }
  entry.overridden = Int32Array.from(applied);
}

/**
 * Replaces the global weather speed factor — mirrors
 * `PathfindingEngine.setWeatherFactor`: clamped to `(0, 1]` so it can only
 * ever slow the network down, never speed it up (see the admissibility note
 * in `pathfinding/cost.ts`). Unlike {@link applySpeedOverrides} this needs no
 * per-edge bookkeeping since it is a single global multiplier read directly by
 * {@link dynamicEdgeCost}.
 */
function applyWeatherFactor(factor: number): void {
  _weatherFactor = clampWeatherFactor(factor);
}

// ---------------------------------------------------------------------------
// Worker bootstrap
// ---------------------------------------------------------------------------

if (parentPort) {
  const { geojsonPath, landmarkCount, freeFlowFactors, driveSide, speedProfileRatio } =
    workerData as PathfindingWorkerData;
  const nodes = buildGraph(
    geojsonPath,
    landmarkCount,
    freeFlowFactors,
    driveSide,
    speedProfileRatio ?? null
  );

  parentPort.on(
    "message",
    (msg: {
      type: string;
      id: number;
      startId: string;
      endId: string;
      incidentEdges?: Record<string, number>;
      restrictedHighways?: string[];
      indices?: Int32Array;
      speeds?: Float32Array;
      factor?: number;
      arrival?: WorkerArrival;
    }) => {
      if (msg.type === "speedProfile") {
        applySpeedOverrides(nodes, { indices: msg.indices!, speeds: msg.speeds! });
        return;
      }
      if (msg.type === "weather") {
        applyWeatherFactor(msg.factor ?? 1);
        return;
      }
      if (msg.type === "findRoute") {
        let route = findRoute(
          nodes,
          msg.startId,
          msg.endId,
          msg.incidentEdges,
          msg.restrictedHighways,
          msg.arrival
        );
        // Fallback: if no route found with highway restrictions, retry without
        if (!route && msg.restrictedHighways && msg.restrictedHighways.length > 0) {
          route = findRoute(
            nodes,
            msg.startId,
            msg.endId,
            msg.incidentEdges,
            undefined,
            msg.arrival
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
export {
  buildGraph,
  findRoute,
  applySpeedOverrides,
  applyWeatherFactor,
  calculateDistance,
  computeBaseTravelTime,
  applyDynamicCost,
};
export type { WorkerNode, WorkerEdge, WorkerArrival };

/** Nodes expanded by the most recent `findRoute` call. Test/benchmark hook. */
export function lastExpandedNodes(): number {
  return _lastExpandedNodes;
}

/** The ALT heuristic built by the last `buildGraph` call, if any. Test hook. */
export function landmarkHeuristic(): AltHeuristic | null {
  return _alt;
}

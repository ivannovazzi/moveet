/**
 * Flat, transferable form of a {@link BuiltNetwork}, so a graph built in a
 * worker thread can be handed to the main thread cheaply.
 *
 * The built graph cannot be posted as is: nodes and edges point at each other
 * (`node.connections` -> edge -> `edge.start`), and structured clone recurses
 * through that and overflows the stack on a city-sized network. Even when it
 * fits, deserializing it is one long synchronous call on the receiving thread.
 *
 * So the worker packs the graph into typed arrays (transferred, not copied)
 * plus a few string tables, and the main thread rebuilds the objects with
 * {@link unpackGraph}, a generator run in time slices so the event loop keeps
 * serving requests. The long object and string lists ({@link PackedLists}:
 * node ids, POIs, speed-limit signs and the LineString features, the bulk of
 * the payload) travel separately in chunks, one message each, because a
 * message is deserialized in one go.
 *
 * Unpacking reproduces the builder's output exactly: the same Map key orders,
 * the same object shapes and property order, the same sharing (each edge is one
 * object, referenced from the edge map, its start node's `connections` and the
 * connected-edge lists; each road's streets are its features' coordinate arrays).
 */

import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Edge, HighwayType, Node, POI } from "../../types";
import type { LandmarkIndex } from "../pathfinding/landmarks";
import { SLICE_MASK } from "../../utils/sliced";
import type { BuiltNetwork, SpeedLimitSign } from "./GraphBuilder";
import type { Road, Street } from "./types";

/** Per-edge numeric fields, `EDGE_STRIDE` per edge in {@link PackedGraph.edgeNumbers}. */
const EDGE_STRIDE = 8;
const NO_INDEX = -1;

export interface PackedGraph {
  /** Interned strings: street ids, names, highway classes, surfaces. */
  strings: string[];

  // Nodes, in the builder's insertion order (ids are in PackedLists).
  /** `[lat, lon]` per node. */
  nodeCoords: Float64Array;
  /** 1 where `trafficSignal` is set. */
  nodeSignal: Uint8Array;
  /** `degree`, or -1 when unset. */
  nodeDegree: Int32Array;
  /** ALT `altIndex`, or -1 when unset (landmarks disabled). */
  nodeAlt: Int32Array;
  /** `node.connections` as a CSR over edge indices. */
  connOffsets: Int32Array;
  connEdges: Int32Array;

  // Every distinct edge object (an edge id can repeat: a later edge with the
  // same id replaces the earlier one in the edge map, but both stay in their
  // start node's connections, exactly as the builder leaves them).
  edgeStart: Int32Array;
  edgeEnd: Int32Array;
  /** String-table indices: streetId, name, highway, surface. */
  edgeStreet: Int32Array;
  edgeName: Int32Array;
  edgeHighway: Int32Array;
  edgeSurface: Int32Array;
  /** distance, bearing, maxSpeed, freeFlowSpeed, lanes, capacity, smoothnessFactor, nodeDelayH (NaN = unset). */
  edgeNumbers: Float64Array;
  edgeOneway: Uint8Array;

  /** Edge map values in order (keys are the edges' ids). */
  edgeOrder: Int32Array;
  /** `edgeBaseCost`, aligned with {@link edgeOrder}. */
  edgeBaseCost: Float64Array;
  /** `connectedEdges` values as a CSR aligned with {@link edgeOrder}. */
  connectedOffsets: Int32Array;
  connectedEdges: Int32Array;

  turnBans: Array<[string, string[]]>;
  maxNetworkSpeed: number;
  landmarks: LandmarkIndex | null;

  // Roads: distinct Road objects, then the road map's keys pointing at them.
  roadName: Int32Array;
  roadNameEn: Int32Array;
  /** `road.nodeIds` (Set insertion order) as a CSR over node indices. */
  roadNodeOffsets: Int32Array;
  roadNodes: Int32Array;
  /** `road.streets` as a CSR over LineString feature indices. */
  roadStreetOffsets: Int32Array;
  roadStreets: Int32Array;
  roadKeys: string[];
  roadKeyTarget: Int32Array;

  /** The LineString collection minus its features (`features` is null, in place). */
  lineStringHeader: Record<string, unknown>;
  /** Lengths of the lists sent alongside, checked on arrival. */
  listLengths: { [K in keyof PackedLists]: number };
}

/** The long lists, sent separately (in chunks) from {@link PackedGraph}. */
export interface PackedLists {
  /** Node ids, aligned with the node arrays. */
  nodeIds: string[];
  pois: POI[];
  speedLimits: SpeedLimitSign[];
  /** The LineString features (roads point into this list). */
  features: Feature[];
}

export interface PackResult {
  graph: PackedGraph;
  lists: PackedLists;
  /** Buffers to transfer with the graph message. */
  transfer: ArrayBuffer[];
}

/** Packs a built network for transfer to another thread. */
export function packGraph(built: BuiltNetwork): PackResult {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (s: string): number => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      stringIndex.set(s, i);
    }
    return i;
  };

  // ── Nodes ──
  const nodeCount = built.nodes.size;
  const nodeIndex = new Map<Node, number>();
  const nodeIds: string[] = new Array(nodeCount);
  const nodeCoords = new Float64Array(nodeCount * 2);
  const nodeSignal = new Uint8Array(nodeCount);
  const nodeDegree = new Int32Array(nodeCount);
  const nodeAlt = new Int32Array(nodeCount);
  let n = 0;
  for (const [key, node] of built.nodes) {
    if (key !== node.id) throw new Error(`Node key ${key} does not match its id ${node.id}`);
    nodeIndex.set(node, n);
    nodeIds[n] = node.id;
    nodeCoords[2 * n] = node.coordinates[0];
    nodeCoords[2 * n + 1] = node.coordinates[1];
    if (node.trafficSignal !== undefined && node.trafficSignal !== true) {
      throw new Error(`Unexpected trafficSignal value on node ${node.id}`);
    }
    nodeSignal[n] = node.trafficSignal ? 1 : 0;
    nodeDegree[n] = node.degree ?? NO_INDEX;
    nodeAlt[n] = (node as Node & { altIndex?: number }).altIndex ?? NO_INDEX;
    n++;
  }
  const indexOfNode = (node: Node): number => {
    const i = nodeIndex.get(node);
    if (i === undefined) throw new Error(`Edge endpoint ${node.id} is not a graph node`);
    return i;
  };

  // ── Edges: every distinct object, discovered through connections and the map ──
  const edgeIndex = new Map<Edge, number>();
  const edgeList: Edge[] = [];
  const indexOfEdge = (edge: Edge): number => {
    let i = edgeIndex.get(edge);
    if (i === undefined) {
      i = edgeList.length;
      edgeList.push(edge);
      edgeIndex.set(edge, i);
    }
    return i;
  };

  const connOffsets = new Int32Array(nodeCount + 1);
  const conn: number[] = [];
  n = 0;
  for (const node of built.nodes.values()) {
    for (const edge of node.connections) conn.push(indexOfEdge(edge));
    connOffsets[++n] = conn.length;
  }

  const edgeOrder = new Int32Array(built.edges.size);
  const edgeBaseCost = new Float64Array(built.edges.size);
  const connectedOffsets = new Int32Array(built.edges.size + 1);
  const connected: number[] = [];
  const baseCostKeys = built.edgeBaseCost.keys();
  const connectedKeys = built.connectedEdges.keys();
  let e = 0;
  for (const [key, edge] of built.edges) {
    if (key !== edge.id) throw new Error(`Edge key ${key} does not match its id ${edge.id}`);
    if (baseCostKeys.next().value !== key || connectedKeys.next().value !== key) {
      throw new Error("Edge cost and connected-edge maps are not aligned with the edge map");
    }
    edgeOrder[e] = indexOfEdge(edge);
    edgeBaseCost[e] = built.edgeBaseCost.get(key)!;
    for (const next of built.connectedEdges.get(key)!) connected.push(indexOfEdge(next));
    connectedOffsets[++e] = connected.length;
  }
  if (built.edgeBaseCost.size !== e || built.connectedEdges.size !== e) {
    throw new Error("Edge cost and connected-edge maps are not aligned with the edge map");
  }

  const edgeCount = edgeList.length;
  const edgeStart = new Int32Array(edgeCount);
  const edgeEnd = new Int32Array(edgeCount);
  const edgeStreet = new Int32Array(edgeCount);
  const edgeName = new Int32Array(edgeCount);
  const edgeHighway = new Int32Array(edgeCount);
  const edgeSurface = new Int32Array(edgeCount);
  const edgeNumbers = new Float64Array(edgeCount * EDGE_STRIDE);
  const edgeOneway = new Uint8Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    const edge = edgeList[i];
    // Unpacking derives the id from the endpoints, as the builder names edges.
    if (edge.id !== `${edge.start.id}-${edge.end.id}`) {
      throw new Error(`Edge ${edge.id} is not named after its endpoints`);
    }
    edgeStart[i] = indexOfNode(edge.start);
    edgeEnd[i] = indexOfNode(edge.end);
    edgeStreet[i] = intern(edge.streetId);
    edgeName[i] = intern(edge.name ?? "");
    edgeHighway[i] = intern(edge.highway);
    edgeSurface[i] = intern(edge.surface);
    const o = i * EDGE_STRIDE;
    edgeNumbers[o] = edge.distance;
    edgeNumbers[o + 1] = edge.bearing;
    edgeNumbers[o + 2] = edge.maxSpeed;
    edgeNumbers[o + 3] = edge.freeFlowSpeed!;
    edgeNumbers[o + 4] = edge.lanes!;
    edgeNumbers[o + 5] = edge.capacity!;
    edgeNumbers[o + 6] = edge.smoothnessFactor!;
    edgeNumbers[o + 7] = edge.nodeDelayH ?? NaN;
    edgeOneway[i] = edge.oneway ? 1 : 0;
  }

  // ── LineString features and roads ──
  const { features, ...rest } = built.lineStringFeatures;
  const lineStringHeader: Record<string, unknown> = {};
  for (const key of Object.keys(built.lineStringFeatures)) {
    lineStringHeader[key] = key === "features" ? null : (rest as Record<string, unknown>)[key];
  }
  const featureOfStreet = new Map<unknown, number>();
  features.forEach((feature, i) => {
    featureOfStreet.set((feature.geometry as LineString).coordinates, i);
  });

  const roadIndex = new Map<Road, number>();
  const roadList: Road[] = [];
  const roadKeys: string[] = [];
  const roadKeyTarget = new Int32Array(built.roads.size);
  for (const [key, road] of built.roads) {
    let i = roadIndex.get(road);
    if (i === undefined) {
      i = roadList.length;
      roadList.push(road);
      roadIndex.set(road, i);
    }
    roadKeyTarget[roadKeys.length] = i;
    roadKeys.push(key);
  }
  const roadName = new Int32Array(roadList.length);
  const roadNameEn = new Int32Array(roadList.length);
  const roadNodeOffsets = new Int32Array(roadList.length + 1);
  const roadStreetOffsets = new Int32Array(roadList.length + 1);
  const roadNodes: number[] = [];
  const roadStreets: number[] = [];
  roadList.forEach((road, i) => {
    roadName[i] = intern(road.name);
    roadNameEn[i] = intern(road.nameEn);
    for (const id of road.nodeIds) {
      const node = built.nodes.get(id);
      if (!node) throw new Error(`Road ${road.name} references unknown node ${id}`);
      roadNodes.push(indexOfNode(node));
    }
    roadNodeOffsets[i + 1] = roadNodes.length;
    for (const street of road.streets) {
      const f = featureOfStreet.get(street);
      if (f === undefined) throw new Error(`Road ${road.name} has a street with no feature`);
      roadStreets.push(f);
    }
    roadStreetOffsets[i + 1] = roadStreets.length;
  });

  const lists: PackedLists = {
    nodeIds,
    pois: built.pois,
    speedLimits: built.speedLimits,
    features,
  };
  const graph: PackedGraph = {
    strings,
    nodeCoords,
    nodeSignal,
    nodeDegree,
    nodeAlt,
    connOffsets,
    connEdges: Int32Array.from(conn),
    edgeStart,
    edgeEnd,
    edgeStreet,
    edgeName,
    edgeHighway,
    edgeSurface,
    edgeNumbers,
    edgeOneway,
    edgeOrder,
    edgeBaseCost,
    connectedOffsets,
    connectedEdges: Int32Array.from(connected),
    turnBans: [...built.turnBans].map(([from, banned]) => [from, [...banned]]),
    maxNetworkSpeed: built.maxNetworkSpeed,
    landmarks: built.landmarks,
    roadName,
    roadNameEn,
    roadNodeOffsets,
    roadNodes: Int32Array.from(roadNodes),
    roadStreetOffsets,
    roadStreets: Int32Array.from(roadStreets),
    roadKeys,
    roadKeyTarget,
    lineStringHeader,
    listLengths: {
      nodeIds: nodeIds.length,
      pois: built.pois.length,
      speedLimits: built.speedLimits.length,
      features: features.length,
    },
  };

  const transfer = new Set<ArrayBuffer>();
  for (const value of Object.values(graph)) {
    if (ArrayBuffer.isView(value)) transfer.add(value.buffer as ArrayBuffer);
  }
  if (built.landmarks) {
    transfer.add(built.landmarks.distFrom.buffer as ArrayBuffer);
    transfer.add(built.landmarks.distTo.buffer as ArrayBuffer);
    transfer.add(built.landmarks.landmarks.buffer as ArrayBuffer);
  }
  return { graph, lists, transfer: [...transfer] };
}

/**
 * Rebuilds the {@link BuiltNetwork} from a packed graph and its LineString
 * features. A generator: it yields every few thousand objects so the caller
 * can run it in time slices (`runSliced`) or straight through (`runToEnd`).
 */
export function* unpackGraph(
  graph: PackedGraph,
  lists: PackedLists
): Generator<void, BuiltNetwork> {
  for (const key of Object.keys(graph.listLengths) as Array<keyof PackedLists>) {
    if (lists[key].length !== graph.listLengths[key]) {
      throw new Error(`Expected ${graph.listLengths[key]} ${key}, got ${lists[key].length}`);
    }
  }
  const { strings } = graph;
  const { nodeIds: ids, features } = lists;

  // ── Nodes (connections filled once the edges exist) ──
  const nodeCount = ids.length;
  const nodeList: Node[] = new Array(nodeCount);
  const nodes = new Map<string, Node>();
  for (let i = 0; i < nodeCount; i++) {
    const node: Node = {
      id: ids[i],
      coordinates: [graph.nodeCoords[2 * i], graph.nodeCoords[2 * i + 1]],
      connections: [],
    };
    // Same property order as the builder: trafficSignal, then degree, then altIndex.
    if (graph.nodeSignal[i] === 1) node.trafficSignal = true;
    if (graph.nodeDegree[i] !== NO_INDEX) node.degree = graph.nodeDegree[i];
    if (graph.nodeAlt[i] !== NO_INDEX) {
      (node as Node & { altIndex?: number }).altIndex = graph.nodeAlt[i];
    }
    nodeList[i] = node;
    nodes.set(node.id, node);
    if ((i & SLICE_MASK) === 0) yield;
  }

  // ── Edges ──
  const edgeCount = graph.edgeStart.length;
  const edgeList: Edge[] = new Array(edgeCount);
  const num = graph.edgeNumbers;
  for (let i = 0; i < edgeCount; i++) {
    const start = nodeList[graph.edgeStart[i]];
    const end = nodeList[graph.edgeEnd[i]];
    const o = i * EDGE_STRIDE;
    const edge: Edge = {
      id: `${start.id}-${end.id}`,
      streetId: strings[graph.edgeStreet[i]],
      start,
      end,
      distance: num[o],
      bearing: num[o + 1],
      name: strings[graph.edgeName[i]],
      highway: strings[graph.edgeHighway[i]] as HighwayType,
      maxSpeed: num[o + 2],
      freeFlowSpeed: num[o + 3],
      surface: strings[graph.edgeSurface[i]],
      oneway: graph.edgeOneway[i] === 1,
      lanes: num[o + 4],
      capacity: num[o + 5],
      smoothnessFactor: num[o + 6],
    };
    if (!Number.isNaN(num[o + 7])) edge.nodeDelayH = num[o + 7];
    edgeList[i] = edge;
    if ((i & SLICE_MASK) === 0) yield;
  }

  for (let i = 0; i < nodeCount; i++) {
    const connections = nodeList[i].connections;
    for (let k = graph.connOffsets[i]; k < graph.connOffsets[i + 1]; k++) {
      connections.push(edgeList[graph.connEdges[k]]);
    }
    if ((i & SLICE_MASK) === 0) yield;
  }

  const edges = new Map<string, Edge>();
  const edgeBaseCost = new Map<string, number>();
  const connectedEdges = new Map<string, Edge[]>();
  for (let i = 0; i < graph.edgeOrder.length; i++) {
    const edge = edgeList[graph.edgeOrder[i]];
    edges.set(edge.id, edge);
    edgeBaseCost.set(edge.id, graph.edgeBaseCost[i]);
    const next: Edge[] = [];
    for (let k = graph.connectedOffsets[i]; k < graph.connectedOffsets[i + 1]; k++) {
      next.push(edgeList[graph.connectedEdges[k]]);
    }
    connectedEdges.set(edge.id, next);
    if ((i & SLICE_MASK) === 0) yield;
  }

  // ── Roads ──
  const roadList: Road[] = new Array(graph.roadName.length);
  for (let i = 0; i < roadList.length; i++) {
    const nodeIds = new Set<string>();
    for (let k = graph.roadNodeOffsets[i]; k < graph.roadNodeOffsets[i + 1]; k++) {
      nodeIds.add(ids[graph.roadNodes[k]]);
    }
    const streets: Street[] = [];
    for (let k = graph.roadStreetOffsets[i]; k < graph.roadStreetOffsets[i + 1]; k++) {
      streets.push((features[graph.roadStreets[k]].geometry as LineString).coordinates as Street);
    }
    roadList[i] = {
      name: strings[graph.roadName[i]],
      nameEn: strings[graph.roadNameEn[i]],
      nodeIds,
      streets,
    };
    if ((i & SLICE_MASK) === 0) yield;
  }
  const roads = new Map<string, Road>();
  for (let i = 0; i < graph.roadKeys.length; i++) {
    roads.set(graph.roadKeys[i], roadList[graph.roadKeyTarget[i]]);
  }

  const turnBans = new Map<string, Set<string>>();
  for (const [from, banned] of graph.turnBans) turnBans.set(from, new Set(banned));

  const lineStringFeatures = { ...graph.lineStringHeader, features } as FeatureCollection;

  return {
    nodes,
    edges,
    roads,
    edgeBaseCost,
    connectedEdges,
    turnBans,
    maxNetworkSpeed: graph.maxNetworkSpeed,
    pois: lists.pois,
    speedLimits: lists.speedLimits,
    lineStringFeatures,
    landmarks: graph.landmarks,
  };
}

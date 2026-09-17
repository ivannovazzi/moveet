/**
 * Builds the road-network graph (nodes, edges, roads, connected-edge lookups,
 * per-edge base costs, turn bans, node degrees) from a GeoJSON FeatureCollection, and
 * eagerly derives every product that was previously read lazily from the raw
 * FeatureCollection (POIs, speed-limit signs, the LineString-only feature view).
 *
 * The motivation (architecture review #5): the raw 22 MB FeatureCollection used
 * to be retained on the RoadNetwork instance FOREVER because several getters
 * re-scanned `data.features` on demand. By deriving everything the runtime needs
 * up front, the caller can drop its reference to the raw collection so it can be
 * garbage-collected — the built graph is the single source of truth at runtime.
 */

import crypto from "crypto";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Node, Edge, POI, HighwayType } from "../../types";
import * as utils from "../../utils/helpers";
import {
  computeBaseTravelTime,
  landmarkLowerBoundCost,
  mergeNodeControl,
  nodeDelayHours,
  TRAFFIC_CALMING_MAX_SPEED_KMH,
  type NodeControl,
} from "../pathfinding/cost";
import { parseTurnRestriction, resolveTurnBans, type TurnRestriction } from "../pathfinding/turns";
import {
  type AltIndexed,
  type LandmarkIndex,
  DEFAULT_LANDMARK_COUNT,
  buildCsrPair,
  buildLandmarkIndex,
  sortedNodeIds,
} from "../pathfinding/landmarks";
import {
  type Road,
  type Street,
  parseSmoothness,
  resolveMaxSpeed,
  parseOneway,
  parseNodeControls,
  MAX_CONTROL_SNAP_KM,
  DEFAULT_FREE_FLOW_FACTORS,
  VALID_HIGHWAYS,
} from "./types";

export interface SpeedLimitSign {
  id: string;
  speed: number;
  coordinates: [number, number]; // [lat, lon]
  highway: string;
}

/** The fully derived graph plus the eagerly-computed data-backed collections. */
export interface BuiltNetwork {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
  roads: Map<string, Road>;
  edgeBaseCost: Map<string, number>;
  connectedEdges: Map<string, Edge[]>;
  /**
   * OSM turn restrictions resolved to edge level: arriving edge id -> ids of
   * the edges that may NOT follow it (see `pathfinding/turns.ts`). Empty when
   * the GeoJSON carries no restriction features.
   */
  turnBans: Map<string, Set<string>>;
  maxNetworkSpeed: number;
  /** Eagerly-extracted POIs (Point features). */
  pois: POI[];
  /** Eagerly-extracted speed-limit signs derived from LineString maxspeed tags. */
  speedLimits: SpeedLimitSign[];
  /** LineString-only feature collection (the /network view), with streetId stamped. */
  lineStringFeatures: FeatureCollection;
  /**
   * Precomputed ALT landmark distance tables, or `null` when landmarks are
   * disabled (a landmark count of 0, i.e. `PATHFINDING_LANDMARKS=0`) or the
   * graph is empty. Every `Node` in `nodes` is stamped with its `altIndex` into
   * these tables.
   */
  landmarks: LandmarkIndex | null;
}

const COORD_SNAP_EPSILON = 1e-7;

export interface GraphBuilderOptions {
  /**
   * Number of ALT landmarks to precompute; `0` disables the preprocessing and
   * leaves `BuiltNetwork.landmarks` null. Passed in rather than read from the
   * environment: `PATHFINDING_LANDMARKS` is parsed once by the zod schema in
   * `utils/config.ts` and threaded down from `RoadNetwork`.
   */
  landmarkCount?: number;
  /**
   * Per-highway-class free-flow factors (`FREE_FLOW_FACTORS`, parsed by the zod
   * schema). Defaults to {@link DEFAULT_FREE_FLOW_FACTORS}.
   */
  freeFlowFactors?: Readonly<Record<HighwayType, number>>;
  /**
   * Learned speed profiles' `SPEED_PROFILE_MAX_SPEED_RATIO` when they are
   * enabled, `null`/absent when they are not. When set, the landmark tables and
   * `maxNetworkSpeed` are built on a metric that also lower-bounds every learned
   * cost (see `pathfinding/cost.ts` `landmarkLowerBoundCost`).
   */
  speedProfileRatio?: number | null;
}

export class GraphBuilder {
  private readonly landmarkCount: number;
  private readonly freeFlowFactors: Readonly<Record<HighwayType, number>>;
  private readonly speedProfileRatio: number | null;
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, Edge> = new Map();
  private roads: Map<string, Road> = new Map();
  private edgeBaseCost: Map<string, number> = new Map();
  private connectedEdges: Map<string, Edge[]> = new Map();
  /** Parsed restriction relations, resolved to `turnBans` once the graph exists. */
  private turnRestrictions: TurnRestriction[] = [];
  private turnBans: Map<string, Set<string>> = new Map();
  /** Merged node control (signal/stop/give-way/crossing/level-crossing/calming) by node id. */
  private nodeControls: Map<string, NodeControl> = new Map();

  constructor(options?: GraphBuilderOptions) {
    this.landmarkCount = options?.landmarkCount ?? DEFAULT_LANDMARK_COUNT;
    this.freeFlowFactors = options?.freeFlowFactors ?? DEFAULT_FREE_FLOW_FACTORS;
    this.speedProfileRatio = options?.speedProfileRatio ?? null;
  }

  private snapCoord(val: number): string {
    return (Math.round(val / COORD_SNAP_EPSILON) * COORD_SNAP_EPSILON).toFixed(7);
  }

  public makeNodeKey(lat: number, lon: number): string {
    return `${this.snapCoord(lat)},${this.snapCoord(lon)}`;
  }

  private getOrCreateNode(id: string, coordinates: [number, number]): Node {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, coordinates, connections: [] };
      this.nodes.set(id, node);
    }
    return node;
  }

  /**
   * Builds the full graph and all derived collections from `data`, then returns
   * them. The caller may safely discard `data` once this returns.
   */
  public build(data: FeatureCollection): BuiltNetwork {
    this.buildGraph(data);
    this.buildEdgeBaseCosts();
    this.stampNodeDegrees();
    this.buildTurnBans();

    // Upper bound on the speed the cost is priced at (free-flow ≤ posted), so
    // distance / maxNetworkSpeed never overestimates an edge's base cost.
    let maxSpeed = 0;
    for (const edge of this.edges.values()) {
      const speed = edge.freeFlowSpeed ?? edge.maxSpeed;
      if (speed > maxSpeed) maxSpeed = speed;
    }
    // A learned speed may reach freeFlowSpeed × ratio, so the bound scales too.
    const maxNetworkSpeed = (maxSpeed > 0 ? maxSpeed : 110) * (this.speedProfileRatio ?? 1);

    // ALT landmark preprocessing. Runs on the STATIC base costs only (or their
    // learned-speed lower bound when profiles are enabled), so the bounds it
    // yields stay admissible under the dynamic incident/signal terms A* adds at
    // query time (see pathfinding/landmarks.ts).
    const landmarks = this.buildLandmarks();

    // Eagerly derive the data-backed collections so the raw FeatureCollection
    // can be released by the caller.
    const pois = this.extractPOIs(data);
    const speedLimits = this.extractSpeedLimits(data);
    const lineStringFeatures = this.extractLineStringFeatures(data);

    return {
      nodes: this.nodes,
      edges: this.edges,
      roads: this.roads,
      edgeBaseCost: this.edgeBaseCost,
      connectedEdges: this.connectedEdges,
      turnBans: this.turnBans,
      maxNetworkSpeed,
      pois,
      speedLimits,
      lineStringFeatures,
      landmarks,
    };
  }

  /**
   * Assigns each node its ALT array index (sorted-node-id order, so the worker
   * derives the identical mapping from the same GeoJSON), builds the transient
   * forward/reverse CSR adjacency over the base edge costs, and runs the
   * landmark Dijkstras.
   *
   * Edges with `smoothnessFactor === 0` are excluded, exactly as the A* loop
   * excludes them, which tightens the bound without threatening admissibility.
   */
  private buildLandmarks(): LandmarkIndex | null {
    const requested = this.landmarkCount;
    const nodeCount = this.nodes.size;
    if (requested <= 0 || nodeCount === 0) return null;

    // Sorted-id indexing: identical on the main thread and in every worker.
    // The index is stamped straight onto the Node objects, so the CSR pass below
    // needs no side table (a 300k-entry string→int Map is a real GC cost here).
    const order = sortedNodeIds(this.nodes.keys());
    for (let i = 0; i < order.length; i++) {
      (this.nodes.get(order[i]) as Node & AltIndexed).altIndex = i;
    }

    const capacity = this.edges.size;
    const from = new Int32Array(capacity);
    const to = new Int32Array(capacity);
    const weight = new Float64Array(capacity);
    let edgeCount = 0;
    for (const edge of this.edges.values()) {
      if (edge.smoothnessFactor === 0) continue;
      const cost = this.edgeBaseCost.get(edge.id);
      if (cost === undefined) continue;
      from[edgeCount] = (edge.start as Node & AltIndexed).altIndex!;
      to[edgeCount] = (edge.end as Node & AltIndexed).altIndex!;
      // + the static node-control delay: A* charges it on every relaxation
      // (never scaled by incidents/weather), so it is part of every edge's true
      // cost and folding it in keeps the bound admissible while tightening it.
      weight[edgeCount] =
        landmarkLowerBoundCost(
          cost,
          edge.distance,
          edge.freeFlowSpeed ?? edge.maxSpeed,
          this.speedProfileRatio
        ) + (edge.nodeDelayH ?? 0);
      edgeCount++;
    }

    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, edgeCount);
    return buildLandmarkIndex(forward, reverse, requested);
  }

  private buildGraph(data: FeatureCollection): void {
    data.features.forEach((feature) => {
      if (feature.geometry?.type === "LineString") {
        // OSM way id when present (the network CLI exports it as `@id`), which is
        // what turn restrictions reference; stringified so ids compare equal.
        const streetId = String(
          feature.properties?.id || feature.properties?.["@id"] || crypto.randomUUID()
        );
        // Stamp the resolved streetId back onto the feature for the /network API
        feature.properties!.streetId = streetId;
        const streetName = feature.properties?.name || "";
        const streetNameEn = feature.properties?.["name:en"] || "";
        const coords = (feature.geometry as LineString).coordinates;

        const rawHighway = feature.properties?.highway || "residential";
        const highway: HighwayType = VALID_HIGHWAYS.has(rawHighway)
          ? (rawHighway as HighwayType)
          : "residential";
        const forwardMaxSpeed = resolveMaxSpeed(feature.properties, highway, "forward");
        const backwardMaxSpeed = resolveMaxSpeed(feature.properties, highway, "backward");
        const freeFlowFactor = this.freeFlowFactors[highway];
        const surface: string = feature.properties?.surface || "unknown";
        const onewayDir = parseOneway(feature.properties?.oneway);
        const isRoundabout = feature.properties?.junction === "roundabout";
        // Roundabouts are implicitly one-way forward regardless of the oneway tag
        const effectiveOneway = isRoundabout ? "forward" : onewayDir;
        // Apply speed reduction for roundabout segments
        const roundaboutFactor = isRoundabout ? 0.5 : 1;
        const forwardSpeed = forwardMaxSpeed * roundaboutFactor;
        const backwardSpeed = backwardMaxSpeed * roundaboutFactor;

        // A way-level traffic_calming tag (chicane/choker/bump run the length
        // of the segment, unlike a point feature at a single node) caps the
        // free-flow speed instead of adding a node delay — see `nodeControls`
        // below for the point-feature case.
        const wayCalming = feature.properties?.traffic_calming;
        const calmingSpeedCap =
          wayCalming && wayCalming !== "no" ? TRAFFIC_CALMING_MAX_SPEED_KMH : Infinity;

        // Skip access-restricted roads (private estates, gated communities)
        const accessTag = feature.properties?.access;
        const motorVehicleTag = feature.properties?.motor_vehicle;
        if (
          accessTag === "private" ||
          accessTag === "no" ||
          motorVehicleTag === "private" ||
          motorVehicleTag === "no"
        ) {
          return; // skip this feature entirely
        }

        const smoothnessFactor = parseSmoothness(feature.properties?.smoothness);
        const rawLanes = parseInt(feature.properties?.lanes ?? "1", 10);
        const lanes = isNaN(rawLanes) || rawLanes < 1 ? 1 : rawLanes;
        const capacity = lanes * 1800; // HCM: 1800 veh/hour per lane

        // Initialize or get existing road
        if (!this.roads.has(streetName)) {
          this.roads.set(streetName, {
            name: streetName,
            nameEn: streetNameEn,
            nodeIds: new Set<string>(),
            streets: [],
          });
        }
        // Also index by English name for multilingual search
        if (streetNameEn && streetNameEn !== streetName && !this.roads.has(streetNameEn)) {
          this.roads.set(streetNameEn, this.roads.get(streetName)!);
        }
        const road = this.roads.get(streetName)!;

        road.streets.push(coords as Street);

        // Build edges
        for (let i = 0; i < coords.length - 1; i++) {
          const [lon1, lat1] = coords[i];
          const [lon2, lat2] = coords[i + 1];

          const node1 = this.getOrCreateNode(this.makeNodeKey(lat1, lon1), [lat1, lon1]);
          const node2 = this.getOrCreateNode(this.makeNodeKey(lat2, lon2), [lat2, lon2]);

          road.nodeIds.add(node1.id);
          road.nodeIds.add(node2.id);

          const distance = utils.calculateDistance(node1.coordinates, node2.coordinates);
          const bearing = utils.calculateBearing(node1.coordinates, node2.coordinates);

          // Forward edge (node1 → node2): skip if reverse one-way
          if (effectiveOneway !== "reverse") {
            const forwardEdge: Edge = {
              id: `${node1.id}-${node2.id}`,
              streetId,
              start: node1,
              end: node2,
              distance,
              bearing,
              name: streetName,
              highway,
              maxSpeed: forwardSpeed,
              freeFlowSpeed: Math.min(forwardSpeed * freeFlowFactor, calmingSpeedCap),
              surface,
              oneway: effectiveOneway === "forward",
              lanes,
              capacity,
              smoothnessFactor,
            };
            this.edges.set(forwardEdge.id, forwardEdge);
            node1.connections.push(forwardEdge);
          }

          // Reverse edge (node2 → node1): skip if forward one-way
          if (effectiveOneway !== "forward") {
            const reverseEdge: Edge = {
              id: `${node2.id}-${node1.id}`,
              streetId,
              start: node2,
              end: node1,
              distance,
              bearing: (bearing + 180) % 360,
              name: streetName,
              highway,
              maxSpeed: backwardSpeed,
              freeFlowSpeed: Math.min(backwardSpeed * freeFlowFactor, calmingSpeedCap),
              surface,
              oneway: effectiveOneway === "reverse",
              lanes,
              capacity,
              smoothnessFactor,
            };
            this.edges.set(reverseEdge.id, reverseEdge);
            node2.connections.push(reverseEdge);
          }
        }
      }
    });

    // Second pass: collect OSM turn restriction relations (the network CLI
    // emits them as Point features at the via node). They are resolved to
    // edge-level bans in `buildTurnBans` once every edge exists.
    data.features.forEach((feature) => {
      const parsed = parseTurnRestriction(feature.properties ?? {}, feature.geometry, (lat, lon) =>
        this.makeNodeKey(lat, lon)
      );
      if (parsed) this.turnRestrictions.push(parsed);
    });

    // Third pass: mark traffic signal nodes and collect node controls (stop,
    // give-way, crossings, level crossings, point traffic-calming). A node can
    // pick up controls from more than one point feature (or a single feature
    // with a compound `highway=a;b` value); `mergeNodeControl` keeps the
    // highest-priority one per node.
    data.features.forEach((feature) => {
      if (feature.geometry?.type !== "Point") return;
      const props = feature.properties ?? {};
      const controls = parseNodeControls(props);
      if (controls.length === 0) return;

      const [lon, lat] = feature.geometry.coordinates as [number, number];
      const nearest = this.findControlNode(lat, lon);
      if (!nearest) return;

      for (const control of controls) {
        if (control.kind === "traffic_signals") nearest.trafficSignal = true;
        this.nodeControls.set(
          nearest.id,
          mergeNodeControl(this.nodeControls.get(nearest.id), control)
        );
      }
    });
  }

  /**
   * Resolves a Point feature's coordinate to a graph node. Point features
   * tagged on a node shared with a way (the common case for signals/stops/
   * crossings/etc.) round-trip through osmium at IDENTICAL precision to that
   * way vertex, so an exact snapped-key lookup resolves almost every one in
   * O(1); only a genuinely unmatched coordinate falls back to the O(nodes)
   * scan `findNearestNodeDuringBuild` uses. With ~28k control points on the
   * Nairobi extract, that fallback path alone would be too slow to take for
   * every point.
   */
  private findControlNode(lat: number, lon: number): Node | null {
    const exact = this.nodes.get(this.makeNodeKey(lat, lon));
    if (exact) return exact;
    const nearest = this.findNearestNodeDuringBuild([lat, lon]);
    if (!nearest) return null;
    // Unbounded snapping would pin a control on a filtered-out road to
    // whatever graph node happens to be closest, however far away.
    return utils.calculateDistance([lat, lon], nearest.coordinates) <= MAX_CONTROL_SNAP_KM
      ? nearest
      : null;
  }

  /**
   * Precompute the static base travel time for every edge. Must run AFTER the
   * graph is fully built so `edge.start.connections.length` (the BPR flow proxy)
   * reflects all outbound edges of the start node.
   */
  private buildEdgeBaseCosts(): void {
    for (const edge of this.edges.values()) {
      const flow = edge.start.connections.length;
      this.edgeBaseCost.set(edge.id, computeBaseTravelTime(edge, flow));
      // Cache the connected-edge list (outbound edges of this edge's end node,
      // excluding the immediate U-turn back to this edge's start). Stable for
      // the life of the graph, so we compute it once instead of per tick.
      this.connectedEdges.set(
        edge.id,
        edge.end.connections.filter((e) => e.end.id !== edge.start.id)
      );
      // Precomputed node-control delay for arriving at `edge.end` via THIS
      // edge (depends on the approach's own highway class, see cost.ts). Kept
      // out of `edgeBaseCost` (incident/weather factors must not scale it) and
      // added in the A* loop (see `applyDynamicCost`); `buildLandmarks` adds it
      // to the landmark weights, which runs after this.
      const delay = nodeDelayHours(this.nodeControls.get(edge.end.id), edge.highway);
      if (delay > 0) edge.nodeDelayH = delay;
    }
  }

  /**
   * Stamps each node's distinct-neighbour count (inbound or outbound) as
   * `node.degree`, which the turn model uses to tell a dead end / bend /
   * intersection apart. Two-way roads show up in `connections`; a one-way
   * arrival with no edge back is counted from the arriving side.
   */
  private stampNodeDegrees(): void {
    for (const node of this.nodes.values()) {
      const seen: string[] = [];
      for (const edge of node.connections) {
        if (!seen.includes(edge.end.id)) seen.push(edge.end.id);
      }
      node.degree = seen.length;
    }
    for (const edge of this.edges.values()) {
      const end = edge.end;
      if (!end.connections.some((e) => e.end.id === edge.start.id)) {
        end.degree = (end.degree ?? 0) + 1;
      }
    }
  }

  /**
   * Resolves the collected restriction relations into `inEdgeId -> banned
   * outEdgeIds` (see `resolveTurnBans`). The inbound-edge lookup is built only
   * for via nodes, so a network without restrictions pays nothing.
   */
  private buildTurnBans(): void {
    if (this.turnRestrictions.length === 0) return;
    const viaIds = new Set(this.turnRestrictions.map((r) => r.via));
    const toTurnEdge = (e: Edge) => ({
      id: e.id,
      streetId: e.streetId,
      startNodeId: e.start.id,
      endNodeId: e.end.id,
    });
    const incoming = new Map<string, ReturnType<typeof toTurnEdge>[]>();
    for (const edge of this.edges.values()) {
      if (!viaIds.has(edge.end.id)) continue;
      let list = incoming.get(edge.end.id);
      if (!list) {
        list = [];
        incoming.set(edge.end.id, list);
      }
      list.push(toTurnEdge(edge));
    }
    this.turnBans = resolveTurnBans(
      this.turnRestrictions,
      (id) => incoming.get(id) ?? [],
      (id) => (this.nodes.get(id)?.connections ?? []).map(toTurnEdge)
    );
  }

  /**
   * Linear nearest-node scan used ONLY during build (to attach traffic-signal
   * flags). The runtime nearest-node query lives in SpatialIndex; build runs
   * before the spatial grid exists, so a direct scan is used here.
   */
  private findNearestNodeDuringBuild(position: [number, number]): Node | null {
    let nearest: Node | null = null;
    let minDistance = Infinity;
    for (const node of this.nodes.values()) {
      const distance = utils.calculateDistance(position, node.coordinates);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = node;
      }
    }
    return nearest;
  }

  private getPoiType(feature: Feature): string | null {
    if (feature.properties?.amenity) return feature.properties.amenity;
    if (feature.properties?.shop) return "shop";
    if (feature.properties?.leisure) return "leisure";
    if (feature.properties?.craft) return "craft";
    if (feature.properties?.office) return "office";
    if (feature.properties?.highway === "bus_stop") return "bus_stop";
    return null;
  }

  private extractPOIs(data: FeatureCollection): POI[] {
    const poi: POI[] = [];
    for (const feature of data.features) {
      if (feature.geometry?.type === "Point") {
        const type = this.getPoiType(feature);
        if (type === null) continue;
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        poi.push({
          id: feature.properties?.id || crypto.randomUUID(),
          type,
          name: feature.properties?.name || null,
          coordinates: [lat, lon],
        });
      }
    }
    return poi.filter((p) => p.type !== "Unknown");
  }

  private extractSpeedLimits(data: FeatureCollection): SpeedLimitSign[] {
    const signs: SpeedLimitSign[] = [];

    // Deduplicate: one sign per unique (speed, roadName) combination within a sector
    const seen = new Set<string>();

    for (const feature of data.features) {
      if (feature.geometry?.type !== "LineString") continue;
      const props = feature.properties;
      if (!props?.maxspeed) continue;

      const speed = parseInt(props.maxspeed, 10);
      if (isNaN(speed) || speed <= 0) continue;

      const highway = props.highway || "residential";
      const coords = (feature.geometry as LineString).coordinates;

      // Place sign at the midpoint of the road segment
      const midIdx = Math.floor(coords.length / 2);
      const [lon, lat] = coords[midIdx];

      // Dedup key: round to ~100m grid to avoid sign spam
      const gridKey = `${speed}:${(lat * 100) | 0},${(lon * 100) | 0}`;
      if (seen.has(gridKey)) continue;
      seen.add(gridKey);

      signs.push({
        id: `sl-${feature.properties?.["@id"] || feature.properties?.id || signs.length}`,
        speed,
        coordinates: [lat, lon],
        highway,
      });
    }

    return signs;
  }

  private extractLineStringFeatures(data: FeatureCollection): FeatureCollection {
    return {
      ...data,
      // remove the points of interest
      features: data.features.filter((feature) => feature.geometry?.type === "LineString"),
    };
  }
}

/**
 * Main-thread A* pathfinding over the built graph, including the dynamic
 * incident-cost terms, turn penalties and turn bans, the LRU route cache, and
 * the per-edge connected-edge / fallback-edge lookups used by the movement hot
 * path.
 *
 * The search is EDGE-based: a state is "arrived at `edge.end` via `edge`", so
 * the cost of the turn onto the next edge (and whether it is banned) is exact
 * rather than depending on whichever predecessor happened to settle a node
 * first. The heuristic is still a per-node bound (of `edge.end`), and the turn
 * term is >= 0 and bans only delete transitions, so the ALT/haversine bound
 * stays admissible and consistent.
 *
 * Extracted from RoadNetwork (architecture review #6). The static per-edge base
 * cost is precomputed at graph-build time (see GraphBuilder); this engine only
 * applies the dynamic incident/signal terms during the relaxation loop, exactly
 * as before. The cost/heap primitives are shared with the worker-thread A* via
 * `pathfinding/{cost,heap}` so the two implementations cannot drift.
 */

import type { Node, Edge, Route } from "../../types";
import * as utils from "../../utils/helpers";
import { LRUCache, type CacheStats } from "../../utils/LRUCache";
import { applyDynamicCost } from "../pathfinding/cost";
import { EdgeSearchScratch } from "../pathfinding/search";
import {
  DEFAULT_DRIVE_SIDE,
  isUTurnAllowed,
  turnCostHours,
  type DriveSide,
  type TurnNodeContext,
} from "../pathfinding/turns";
import { AltHeuristic, type AltIndexed, type LandmarkIndex } from "../pathfinding/landmarks";

export interface PathfindingEngineDeps {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
  edgeBaseCost: Map<string, number>;
  connectedEdges: Map<string, Edge[]>;
  /** Arriving edge id -> ids of edges that may not follow it (from GraphBuilder). */
  turnBans: Map<string, Set<string>>;
  maxNetworkSpeed: number;
  /** Drive side for turn penalties; defaults to right-hand traffic. */
  driveSide?: DriveSide;
  /** ALT landmark tables from GraphBuilder; omit/null to use the haversine bound alone. */
  landmarks?: LandmarkIndex | null;
}

/** Dense per-graph index stamped on nodes and edges for the typed-array search state. */
interface SearchIndexed {
  searchIndex?: number;
}

export class PathfindingEngine {
  private readonly nodes: Map<string, Node>;
  private readonly edgeBaseCost: Map<string, number>;
  private readonly connectedEdges: Map<string, Edge[]>;
  private readonly turnBans: Map<string, Set<string>>;
  private readonly driveSide: DriveSide;
  private readonly maxNetworkSpeed: number;

  /**
   * Reusable ALT heuristic (null when landmark preprocessing is disabled).
   * A single instance is safe because `findRoute` is synchronous — the target
   * is re-pinned at the top of every search.
   */
  private readonly alt: AltHeuristic | null;
  /** Whether the ALT bound applies to the search currently in progress. */
  private altActive = false;

  /** Nodes expanded (heap pops that were not stale) by the last `findRoute` call. */
  private lastExpandedNodes = 0;

  // Incident-based edge cost penalties: edge ID → speedFactor (lowest wins; 0 = blocked)
  private incidentEdges: Map<string, number> = new Map();
  private cachedIncidentFingerprint: string | null = null;

  // A* route cache — avoids recomputing identical start→end routes
  private routeCache: LRUCache<Route>;

  /** Every searchable edge by `searchIndex`; built with the scratch on first search. */
  private searchEdges: Edge[] = [];
  /** `edgeBaseCost` by `searchIndex`. */
  private searchBaseCost = new Float64Array(0);
  private scratch: EdgeSearchScratch | null = null;

  // Lazily-built cache of synthetic "U-turn" fallback edges (one per real edge).
  private fallbackEdges: Map<string, Edge> = new Map();

  constructor(deps: PathfindingEngineDeps, cacheOptions?: { maxSize?: number; ttlMs?: number }) {
    this.nodes = deps.nodes;
    this.edgeBaseCost = deps.edgeBaseCost;
    this.connectedEdges = deps.connectedEdges;
    this.turnBans = deps.turnBans;
    this.driveSide = deps.driveSide ?? DEFAULT_DRIVE_SIDE;
    this.maxNetworkSpeed = deps.maxNetworkSpeed;
    this.alt = deps.landmarks ? new AltHeuristic(deps.landmarks) : null;

    this.routeCache = new LRUCache<Route>({
      maxSize: cacheOptions?.maxSize ?? 500,
      ttlMs: cacheOptions?.ttlMs ?? 60_000,
      // Sliding expiry: frequently used routes stay cached
      updateAgeOnGet: true,
    });
  }

  public getConnectedEdges(edge: Edge): Edge[] {
    // Hot path (called every tick per vehicle): return the cached list computed
    // at graph-build time. Fall back to on-demand computation for synthetic
    // edges that are not part of the built graph (e.g. fallback U-turn edges).
    const cached = this.connectedEdges.get(edge.id);
    if (cached) return cached;
    return edge.end.connections.filter((e) => e.end.id !== edge.start.id);
  }

  /**
   * Returns the synthetic reverse ("U-turn") edge for a dead-end edge — cached
   * per edge so the hot path allocates nothing after first use.
   */
  public getFallbackEdge(edge: Edge): Edge {
    let fallback = this.fallbackEdges.get(edge.id);
    if (!fallback) {
      fallback = {
        ...edge,
        start: edge.end,
        end: edge.start,
        bearing: (edge.bearing + 180) % 360,
        oneway: false,
      };
      this.fallbackEdges.set(edge.id, fallback);
    }
    return fallback;
  }

  /**
   * Finds the shortest route between two nodes using A* pathfinding.
   * Returns null if no route exists between the nodes.
   */
  public findRoute(start: Node, end: Node): Route | null {
    // Check cache first
    const cacheKey = `${start.id}|${end.id}|${this.incidentFingerprint()}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return { edges: [...cached.edges], distance: cached.distance };

    this.lastExpandedNodes = 0;
    if (start.id === end.id) {
      const empty: Route = { edges: [], distance: 0 };
      this.routeCache.set(cacheKey, empty);
      return { edges: [], distance: 0 };
    }

    // Typed-array state indexed by edge `searchIndex` (see pathfinding/search.ts).
    const scratch = this.getScratch();
    const search = scratch.begin();
    const { g, gStamp, closedStamp, prev, heap } = scratch;
    const edges = this.searchEdges;

    // Pin the ALT heuristic to this target. It stays inactive when landmarks are
    // disabled or when no landmark bounds this target, in which case the
    // heuristic degrades to exactly the previous haversine bound.
    this.altActive = this.alt ? this.alt.setTarget((end as Node & AltIndexed).altIndex) : false;

    // Seed with every usable edge out of the start node. There is no arriving
    // edge yet, so no turn is charged.
    for (const edge of start.connections) {
      const i = (edge as Edge & SearchIndexed).searchIndex!;
      const travelTime = this.dynamicEdgeCost(edge, i);
      if (travelTime < 0) continue;
      if (gStamp[i] === search && g[i] <= travelTime) continue;
      gStamp[i] = search;
      g[i] = travelTime;
      prev[i] = -1;
      heap.push(i, travelTime + this.cachedHeuristic(scratch, search, edge.end, end));
    }

    while (heap.size > 0) {
      const current = heap.pop();

      // Lazy deletion: a stale duplicate for an already-expanded edge. Any entry
      // that survives this check carries the edge's current best g.
      if (closedStamp[current] === search) continue;
      this.lastExpandedNodes++;

      const arrival = edges[current];
      const node = arrival.end;
      if (node.id === end.id) {
        const route = this.reconstructPath(current, prev);
        this.routeCache.set(cacheKey, route);
        return { edges: [...route.edges], distance: route.distance };
      }

      closedStamp[current] = search;
      const gCurrent = g[current];

      const bans = this.turnBans.size > 0 ? this.turnBans.get(arrival.id) : undefined;
      const turnNode: TurnNodeContext = {
        degree: node.degree ?? node.connections.length,
        signalized: node.trafficSignal === true,
      };
      const inTwoWay = !arrival.oneway;

      for (const edge of node.connections) {
        const j = (edge as Edge & SearchIndexed).searchIndex!;
        if (closedStamp[j] === search) continue;
        // OSM turn restriction resolved to this exact (arrival, edge) pair.
        if (bans !== undefined && bans.has(edge.id)) continue;
        const isUTurn = edge.end === arrival.start;
        if (isUTurn && !isUTurnAllowed(turnNode.degree)) continue;

        const travelTime = this.dynamicEdgeCost(edge, j);
        if (travelTime < 0) continue;

        const tentativeCost =
          gCurrent +
          travelTime +
          turnCostHours(arrival.bearing, edge.bearing, isUTurn, inTwoWay, turnNode, this.driveSide);

        // Strictly better only (ties keep the first-found predecessor); matches
        // the worker-thread A* implementation.
        if (gStamp[j] !== search || tentativeCost < g[j]) {
          gStamp[j] = search;
          g[j] = tentativeCost;
          prev[j] = current;
          heap.push(j, tentativeCost + this.cachedHeuristic(scratch, search, edge.end, end));
        }
      }
    }
    return null;
  }

  /**
   * Lazily indexes every node and edge (insertion order — the worker assigns
   * the same order from the same GeoJSON) and allocates the search scratch.
   * Deferred to the first main-thread search because production routing mostly
   * runs in the worker pool.
   */
  private getScratch(): EdgeSearchScratch {
    if (this.scratch) return this.scratch;
    let nodeIndex = 0;
    const edges: Edge[] = [];
    for (const node of this.nodes.values()) {
      (node as Node & SearchIndexed).searchIndex = nodeIndex++;
      for (const edge of node.connections) {
        (edge as Edge & SearchIndexed).searchIndex = edges.length;
        edges.push(edge);
      }
    }
    this.searchEdges = edges;
    this.searchBaseCost = Float64Array.from(edges, (e) => this.edgeBaseCost.get(e.id) ?? 0);
    this.scratch = new EdgeSearchScratch(edges.length, nodeIndex);
    return this.scratch;
  }

  /** {@link calculateHeuristic}, memoized per node for the current search. */
  private cachedHeuristic(
    scratch: EdgeSearchScratch,
    search: number,
    from: Node,
    to: Node
  ): number {
    const i = (from as Node & SearchIndexed).searchIndex!;
    if (scratch.hStamp[i] === search) return scratch.h[i];
    const h = this.calculateHeuristic(from, to);
    scratch.hStamp[i] = search;
    scratch.h[i] = h;
    return h;
  }

  /**
   * An edge's travel time with the dynamic incident / node-control terms
   * applied, or -1 when the edge cannot be used (closure or impassable).
   */
  private dynamicEdgeCost(edge: Edge, index: number): number {
    // Apply incident-based edge cost penalties
    const incidentFactor =
      this.incidentEdges.size > 0 ? this.incidentEdges.get(edge.id) : undefined;
    if (incidentFactor !== undefined && incidentFactor === 0) return -1; // closure — skip edge

    // Skip impassable roads (smoothnessFactor === 0)
    if (edge.smoothnessFactor === 0) return -1;

    // Static base cost was precomputed at graph-build time; only the dynamic
    // incident/signal terms are applied here in the hot relaxation loop.
    // (Mirrored into a typed array by searchIndex to skip the string-keyed Map.)
    const baseTravelTime = this.searchBaseCost[index];
    return applyDynamicCost(baseTravelTime, incidentFactor, edge.nodeDelayH ?? 0);
  }

  /**
   * The turn cost (hours) the search charges for leaving `from.end` onto `to`
   * — the same value `findRoute` adds, so ETA estimates over a returned route
   * agree with the search. 0 when the edges are not consecutive.
   */
  public turnCostHours(from: Edge, to: Edge): number {
    if (from.end.id !== to.start.id) return 0;
    const node = from.end;
    return turnCostHours(
      from.bearing,
      to.bearing,
      to.end.id === from.start.id,
      !from.oneway,
      { degree: node.degree ?? node.connections.length, signalized: node.trafficSignal === true },
      this.driveSide
    );
  }

  /** Turn bans (arriving edge id -> banned next edge ids). */
  public get bans(): Map<string, Set<string>> {
    return this.turnBans;
  }

  /** Clear all cached routes. */
  public clearRouteCache(): void {
    this.routeCache.clear();
  }

  /** Return hit/miss statistics for the route cache. */
  public routeCacheStats(): CacheStats {
    return this.routeCache.stats();
  }

  /** Look up a cached route by its full cache key (used by the async/worker path). */
  public getCachedRoute(cacheKey: string): Route | null {
    const cached = this.routeCache.get(cacheKey);
    if (cached) return { edges: [...cached.edges], distance: cached.distance };
    return null;
  }

  /** Store a route under a cache key (used by the async/worker path). */
  public setCachedRoute(cacheKey: string, route: Route): void {
    this.routeCache.set(cacheKey, route);
  }

  /** The current incident edge speed factors (undefined when none are set). */
  public get incidents(): Map<string, number> {
    return this.incidentEdges;
  }

  /** Replace incident edge speed factors. Cache invalidation is via the fingerprint key. */
  public setIncidentEdges(edgeSpeedFactors: Map<string, number>): void {
    this.incidentEdges = edgeSpeedFactors;
    this.cachedIncidentFingerprint = null;
  }

  /** Clear all incident edge data. Cache invalidation is via the fingerprint key. */
  public clearIncidentEdges(): void {
    this.incidentEdges.clear();
    this.cachedIncidentFingerprint = null;
  }

  /**
   * Compute a lightweight fingerprint of the current incident edges for cache
   * keying. Includes the speed factor per edge so a factor change on the same
   * edge set invalidates cached routes.
   */
  public incidentFingerprint(): string {
    if (this.cachedIncidentFingerprint !== null) return this.cachedIncidentFingerprint;
    if (this.incidentEdges.size === 0) {
      this.cachedIncidentFingerprint = "";
    } else {
      this.cachedIncidentFingerprint = Array.from(this.incidentEdges.entries())
        .map(([id, factor]) => `${id}:${factor}`)
        .sort()
        .join(",");
    }
    return this.cachedIncidentFingerprint;
  }

  private reconstructPath(last: number, prev: Int32Array): Route {
    const reversedPath: Edge[] = [];
    let totalDistance = 0;

    for (let i = last; i !== -1; i = prev[i]) {
      const edge = this.searchEdges[i];
      reversedPath.push(edge);
      totalDistance += edge.distance;
    }
    reversedPath.reverse();

    return { edges: reversedPath, distance: totalDistance };
  }

  /**
   * Search states expanded by the most recent `findRoute` call — the number of
   * heap pops that were not stale duplicates. States are edges (see the module
   * header), so this counts arrivals, not distinct nodes. Exposed so tests can
   * assert that the ALT heuristic actually shrinks the search, not just that it
   * stays correct.
   */
  public get expandedNodes(): number {
    return this.lastExpandedNodes;
  }

  private calculateHeuristic(from: Node, to: Node): number {
    // Optimistic estimate: straight-line distance at max possible speed in this network.
    const geographic =
      utils.calculateDistance(from.coordinates, to.coordinates) / this.maxNetworkSpeed;
    if (!this.altActive) return geographic;

    // The ALT triangle-inequality bound is usually far tighter than the
    // straight-line one (maxNetworkSpeed is the network-wide maximum, so the
    // geographic bound is very loose). Both are admissible and consistent, and
    // the max of two consistent heuristics is consistent — so taking the larger
    // is safe and strictly better.
    const landmark = this.alt!.bound((from as Node & AltIndexed).altIndex ?? -1);
    return landmark > geographic ? landmark : geographic;
  }
}

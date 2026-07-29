/**
 * Main-thread A* pathfinding over the built graph, including the dynamic
 * incident-cost terms, the LRU route cache, and the per-edge connected-edge /
 * fallback-edge lookups used by the movement hot path.
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
import { PathNodeHeap } from "../pathfinding/heap";
import { AltHeuristic, type AltIndexed, type LandmarkIndex } from "../pathfinding/landmarks";

export interface PathfindingEngineDeps {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
  edgeBaseCost: Map<string, number>;
  connectedEdges: Map<string, Edge[]>;
  turnRestrictions: Map<string, Set<string>>;
  turnRestrictionTypes: Map<string, "prohibitory" | "mandatory">;
  maxNetworkSpeed: number;
  /** ALT landmark tables from GraphBuilder; omit/null to use the haversine bound alone. */
  landmarks?: LandmarkIndex | null;
}

export class PathfindingEngine {
  private readonly nodes: Map<string, Node>;
  private readonly edgeBaseCost: Map<string, number>;
  private readonly connectedEdges: Map<string, Edge[]>;
  private readonly turnRestrictions: Map<string, Set<string>>;
  private readonly turnRestrictionTypes: Map<string, "prohibitory" | "mandatory">;
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

  // Lazily-built cache of synthetic "U-turn" fallback edges (one per real edge).
  private fallbackEdges: Map<string, Edge> = new Map();

  constructor(deps: PathfindingEngineDeps, cacheOptions?: { maxSize?: number; ttlMs?: number }) {
    this.nodes = deps.nodes;
    this.edgeBaseCost = deps.edgeBaseCost;
    this.connectedEdges = deps.connectedEdges;
    this.turnRestrictions = deps.turnRestrictions;
    this.turnRestrictionTypes = deps.turnRestrictionTypes;
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

    const closedSet = new Set<string>();
    const cameFrom = new Map<string, { prevId: string; edge: Edge }>();
    const gScore = new Map<string, number>();

    // Shared binary min-heap for O(log n) extraction instead of O(n) linear scan
    const heap = new PathNodeHeap();

    // Pin the ALT heuristic to this target. It stays inactive when landmarks are
    // disabled or when no landmark bounds this target, in which case the
    // heuristic degrades to exactly the previous haversine bound.
    this.altActive = this.alt ? this.alt.setTarget((end as Node & AltIndexed).altIndex) : false;
    this.lastExpandedNodes = 0;

    gScore.set(start.id, 0);
    const initialH = this.calculateHeuristic(start, end);
    heap.push({ id: start.id, gScore: 0, fScore: initialH });

    while (heap.size > 0) {
      const current = heap.pop();

      if (closedSet.has(current.id)) continue;
      this.lastExpandedNodes++;

      if (current.id === end.id) {
        const route = this.reconstructPath(start.id, end.id, cameFrom);
        this.routeCache.set(cacheKey, route);
        return route;
      }

      closedSet.add(current.id);
      const currentNode = this.nodes.get(current.id)!;

      for (const edge of currentNode.connections) {
        if (closedSet.has(edge.end.id)) continue;

        // Check turn restrictions: if we arrived at current via a known edge,
        // verify the turn onto `edge` is permitted
        const arrivalEdge = cameFrom.get(current.id)?.edge;
        if (arrivalEdge && this.turnRestrictions.size > 0) {
          const key = `${arrivalEdge.streetId}|${current.id}`;
          const restricted = this.turnRestrictions.get(key);
          if (restricted) {
            const typeKey = `${key}|type`;
            const rtype = this.turnRestrictionTypes.get(typeKey);
            if (rtype === "prohibitory" && restricted.has(edge.streetId)) continue;
            if (rtype === "mandatory" && !restricted.has(edge.streetId)) continue;
          }
        }

        // Apply incident-based edge cost penalties
        const incidentFactor = this.incidentEdges.get(edge.id);
        if (incidentFactor !== undefined && incidentFactor === 0) continue; // closure — skip edge

        // Skip impassable roads (smoothnessFactor === 0)
        if (edge.smoothnessFactor === 0) continue;

        // Static base cost was precomputed at graph-build time; only the dynamic
        // incident/signal terms are applied here in the hot relaxation loop.
        const baseTravelTime = this.edgeBaseCost.get(edge.id)!;
        const travelTime = applyDynamicCost(
          baseTravelTime,
          incidentFactor,
          edge.end.trafficSignal === true
        );
        const tentativeCost = current.gScore + travelTime;
        const existingCost = gScore.get(edge.end.id);

        // Use === undefined (not falsy) so a legitimate gScore of 0 is not
        // treated as unvisited; matches the worker-thread A* implementation.
        if (existingCost === undefined || tentativeCost < existingCost) {
          cameFrom.set(edge.end.id, { prevId: current.id, edge });
          gScore.set(edge.end.id, tentativeCost);

          const h = this.calculateHeuristic(edge.end, end);
          const f = tentativeCost + h;
          heap.push({ id: edge.end.id, gScore: tentativeCost, fScore: f });
        }
      }
    }
    return null;
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

  private reconstructPath(
    startId: string,
    endId: string,
    cameFrom: Map<string, { prevId: string; edge: Edge }>
  ): Route {
    const reversedPath: Edge[] = [];
    let currentId = endId;
    let totalDistance = 0;

    while (currentId !== startId) {
      const { prevId, edge } = cameFrom.get(currentId)!;
      reversedPath.push(edge);
      totalDistance += edge.distance;
      currentId = prevId;
    }
    reversedPath.reverse();

    return { edges: reversedPath, distance: totalDistance };
  }

  /**
   * Nodes expanded by the most recent `findRoute` call — the number of heap pops
   * that were not stale duplicates. Exposed so tests can assert that the ALT
   * heuristic actually shrinks the search, not just that it stays correct.
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

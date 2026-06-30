import fs from "fs";
import type { FeatureCollection } from "geojson";
import type { Node, Edge, Route, HeatZoneFeature, POI, BoundingBox } from "../types";
import { type CacheStats } from "../utils/LRUCache";
import { HeatZoneManager } from "./HeatZoneManager";
import { PathfindingPool } from "./PathfindingPool";
import { GraphBuilder, type SpeedLimitSign } from "./roadnetwork/GraphBuilder";
import { SpatialIndex } from "./roadnetwork/SpatialIndex";
import { PathfindingEngine } from "./roadnetwork/PathfindingEngine";
import type { Road } from "./roadnetwork/types";
import EventEmitter from "events";

/**
 * RoadNetwork is a thin facade over four cohesive collaborators (architecture
 * review #6):
 *
 *  - {@link GraphBuilder}      builds the graph (nodes/edges/roads/connected
 *                              edges/base costs/turn restrictions) and eagerly
 *                              derives the POI / speed-limit / LineString-only
 *                              collections from the raw GeoJSON.
 *  - {@link SpatialIndex}      grid + sector indexes, nearest-node and random
 *                              node/edge/POI-node queries, bbox.
 *  - {@link PathfindingEngine} main-thread A*, incident costs and the LRU
 *                              route cache, plus connected/fallback-edge lookups.
 *  - {@link PathfindingPool}   worker-thread A* pool (lazy-initialized).
 *
 * The raw FeatureCollection is parsed, fed to the builder, and then RELEASED so
 * the ~22 MB blob can be garbage-collected (architecture review #5). Everything
 * the runtime needs is derived into owned structures during build; nothing
 * re-scans the raw collection afterwards.
 *
 * The public surface (class, constructor signature, methods, EventEmitter
 * behaviour) is unchanged so this remains a drop-in for all callers.
 */
export class RoadNetwork extends EventEmitter {
  // Graph structures. `nodes` and `edges` are kept as private fields (and shared
  // by reference with the collaborators) because the test suite reaches into
  // them directly via @ts-expect-error.
  private nodes: Map<string, Node>;
  private edges: Map<string, Edge>;
  private roads: Map<string, Road>;

  private spatial: SpatialIndex;
  private pathfinding: PathfindingEngine;
  private turnRestrictions: Map<string, Set<string>>;
  private turnRestrictionTypes: Map<string, "prohibitory" | "mandatory">;

  // Eagerly-derived, data-backed collections (the raw FeatureCollection is
  // released after build, so these are the source of truth at runtime).
  private pois: POI[];
  private speedLimits: SpeedLimitSign[];
  private lineStringFeatures: FeatureCollection;

  private heatZoneManager: HeatZoneManager = new HeatZoneManager();

  // Worker-thread pathfinding pool (lazy-initialized)
  private pathfindingPool: PathfindingPool | null = null;
  private geojsonPath: string;

  constructor(geojsonPath: string, cacheOptions?: { maxSize?: number; ttlMs?: number }) {
    super();
    this.geojsonPath = geojsonPath;

    // Parse the raw GeoJSON into a local — NOT a field — so the only reference
    // is dropped when the constructor returns and the blob can be GC'd.
    const data = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as FeatureCollection;

    const built = new GraphBuilder().build(data);
    // `data` is now unreferenced from here on; it is released for GC.

    this.nodes = built.nodes;
    this.edges = built.edges;
    this.roads = built.roads;
    this.turnRestrictions = built.turnRestrictions;
    this.turnRestrictionTypes = built.turnRestrictionTypes;
    this.pois = built.pois;
    this.speedLimits = built.speedLimits;
    this.lineStringFeatures = built.lineStringFeatures;

    this.spatial = new SpatialIndex(this.nodes, this.edges, this.pois);
    this.pathfinding = new PathfindingEngine(
      {
        nodes: this.nodes,
        edges: this.edges,
        edgeBaseCost: built.edgeBaseCost,
        connectedEdges: built.connectedEdges,
        turnRestrictions: built.turnRestrictions,
        turnRestrictionTypes: built.turnRestrictionTypes,
        maxNetworkSpeed: built.maxNetworkSpeed,
      },
      cacheOptions
    );
  }

  // ─── Bounding box / random sampling (SpatialIndex) ──────────────────

  public getBoundingBox(): BoundingBox {
    return this.spatial.getBoundingBox();
  }

  public getRandomEdge(): Edge {
    return this.spatial.getRandomEdge();
  }

  public getRandomNode(): Node {
    return this.spatial.getRandomNode();
  }

  public getRandomPOINode(): Node | null {
    return this.spatial.getRandomPOINode();
  }

  public getPOINodes(): Node[] {
    return this.spatial.getPOINodes();
  }

  public findNearestNode(position: [number, number]): Node {
    return this.spatial.findNearestNode(position);
  }

  // ─── Roads / search (graph) ─────────────────────────────────────────

  public getAllRoads(): Road[] {
    const seen = new Set<Road>();
    const roads: Road[] = [];
    for (const road of this.roads.values()) {
      if (!seen.has(road)) {
        seen.add(road);
        roads.push(road);
      }
    }
    return roads;
  }

  /**
   * Finds the nearest road to a given geographic position.
   * First finds the nearest node, then returns the road containing that node.
   *
   * @throws {Error} If no road contains the nearest node
   */
  public findNearestRoad(position: [number, number]): Road {
    const node = this.findNearestNode(position);
    for (const road of this.roads.values()) {
      if (road.nodeIds.has(node.id)) {
        return road;
      }
    }
    throw new Error("Could not find road by node");
  }

  public searchByName(query: string): Array<{
    name: string;
    nameEn: string;
    nodeIds: string[];
    coordinates: [number, number][];
  }> {
    const lowerQuery = query.toLowerCase();
    const seen = new Set<string>();
    const results: Array<{
      name: string;
      nameEn: string;
      nodeIds: string[];
      coordinates: [number, number][];
    }> = [];

    for (const [, road] of this.roads) {
      // Deduplicate — same Road object may be indexed under both name and name:en
      const roadKey = road.name || road.nameEn;
      if (seen.has(roadKey)) continue;

      if (
        road.name.toLowerCase().includes(lowerQuery) ||
        road.nameEn.toLowerCase().includes(lowerQuery)
      ) {
        seen.add(roadKey);
        results.push({
          name: road.name,
          nameEn: road.nameEn,
          nodeIds: Array.from(road.nodeIds),
          coordinates: road.streets.flat(),
        });
      }
    }

    return results;
  }

  // ─── Data-backed collections (derived eagerly, raw blob released) ───

  public getAllPOIs(): Array<POI> {
    return this.pois;
  }

  public getSpeedLimits(): Array<SpeedLimitSign> {
    return this.speedLimits;
  }

  public getFeatures(): FeatureCollection {
    return this.lineStringFeatures;
  }

  // ─── Pathfinding (PathfindingEngine + PathfindingPool) ──────────────

  public getConnectedEdges(edge: Edge): Edge[] {
    return this.pathfinding.getConnectedEdges(edge);
  }

  public getFallbackEdge(edge: Edge): Edge {
    return this.pathfinding.getFallbackEdge(edge);
  }

  /**
   * Finds the shortest route between two nodes using A* pathfinding.
   * Returns null if no route exists between the nodes.
   */
  public findRoute(start: Node, end: Node): Route | null {
    return this.pathfinding.findRoute(start, end);
  }

  /** Expose turn restrictions for testing. Returns a shallow copy of the map. */
  public getTurnRestrictions(): Map<string, Set<string>> {
    return new Map(this.turnRestrictions);
  }

  /** Clear all cached routes. */
  public clearRouteCache(): void {
    this.pathfinding.clearRouteCache();
  }

  /** Replace incident edge speed factors. Cache invalidation is handled by the fingerprint key. */
  public setIncidentEdges(edgeSpeedFactors: Map<string, number>): void {
    this.pathfinding.setIncidentEdges(edgeSpeedFactors);
  }

  /** Clear all incident edge data. Cache invalidation is handled by the fingerprint key. */
  public clearIncidentEdges(): void {
    this.pathfinding.clearIncidentEdges();
  }

  /** Return hit/miss statistics for the route cache. */
  public routeCacheStats(): CacheStats {
    return this.pathfinding.routeCacheStats();
  }

  /** Looks up an edge by its ID. */
  public getEdge(id: string): Edge | undefined {
    return this.edges.get(id);
  }

  /**
   * Async pathfinding that delegates A* to a worker-thread pool.
   * The cache check and route reconstruction happen on the main thread;
   * only the graph traversal runs off-thread.
   *
   * Falls back to synchronous findRoute if the worker pool is unavailable.
   */
  public async findRouteAsync(
    start: Node,
    end: Node,
    restrictedHighways?: string[]
  ): Promise<Route | null> {
    // Check cache first — keyed identically to the sync path, plus the
    // restricted-highway profile (a different profile yields a different route).
    const highwayKey = restrictedHighways?.length ? restrictedHighways.join(",") : "";
    const cacheKey = `${start.id}|${end.id}|${this.pathfinding.incidentFingerprint()}|${highwayKey}`;
    const cached = this.pathfinding.getCachedRoute(cacheKey);
    if (cached) return cached;

    // Lazy-init the pool on first async call
    if (!this.pathfindingPool) {
      this.pathfindingPool = new PathfindingPool(this.geojsonPath);
    }

    const incidentEdges = this.pathfinding.incidents;
    const restrictions =
      this.turnRestrictions.size > 0
        ? Object.fromEntries([...this.turnRestrictions.entries()].map(([k, v]) => [k, [...v]]))
        : undefined;
    const restrictionTypes =
      this.turnRestrictions.size > 0
        ? Object.fromEntries(this.turnRestrictionTypes.entries())
        : undefined;

    const result = await this.pathfindingPool.findRoute(
      start.id,
      end.id,
      incidentEdges.size > 0 ? incidentEdges : undefined,
      restrictedHighways,
      restrictions,
      restrictionTypes
    );
    if (!result) return null;

    // Reconstruct Route using main thread's Edge objects
    const edges: Edge[] = [];
    for (const edgeId of result.edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) return null; // safety: edge map mismatch
      edges.push(edge);
    }

    const route = { edges, distance: result.distance };
    this.pathfinding.setCachedRoute(cacheKey, route);
    return { edges: [...route.edges], distance: route.distance };
  }

  /**
   * Waits (bounded) for in-flight pathfinding-pool requests to settle.
   * Returns true if the pool drained (or was never started) within the timeout.
   */
  public async drainPathfinding(timeoutMs: number): Promise<boolean> {
    if (!this.pathfindingPool) return true;
    return this.pathfindingPool.drain(timeoutMs);
  }

  /**
   * Shuts down the worker-thread pool, if running.
   * Call during graceful shutdown to avoid dangling threads.
   */
  public async shutdownWorkers(): Promise<void> {
    if (this.pathfindingPool) {
      await this.pathfindingPool.shutdown();
      this.pathfindingPool = null;
    }
  }

  // ─── Heat zones (HeatZoneManager) ───────────────────────────────────

  public generateHeatedZones(
    options: {
      count?: number;
      minRadius?: number;
      maxRadius?: number;
      minIntensity?: number;
      maxIntensity?: number;
    } = {}
  ): void {
    const edges = Array.from(this.edges.values());
    const nodes = Array.from(this.nodes.values());
    this.heatZoneManager.generateHeatedZones(edges, nodes, options);
    this.emit("heatzones", this.exportHeatZones());
  }

  public exportHeatZones(): HeatZoneFeature[] {
    return this.heatZoneManager.exportHeatedZonesAsFeatures();
  }

  public isPositionInHeatZone(position: [number, number]): boolean {
    return this.heatZoneManager.isPositionInHeatZone(position);
  }
}

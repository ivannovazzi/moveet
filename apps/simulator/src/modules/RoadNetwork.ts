import fs from "fs";
import crypto from "crypto";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Node, Edge, Route, HeatZoneFeature, POI, HighwayType, BoundingBox } from "../types";
import * as utils from "../utils/helpers";
import { LRUCache, type CacheStats } from "../utils/LRUCache";
import { HeatZoneManager } from "./HeatZoneManager";
import { PathfindingPool } from "./PathfindingPool";
import { SPATIAL_GRID } from "../constants";
import { computeBaseTravelTime, applyDynamicCost } from "./pathfinding/cost";
import { PathNodeHeap } from "./pathfinding/heap";
import EventEmitter from "events";

type Street = [number, number][];
interface Road {
  name: string;
  nameEn: string;
  nodeIds: Set<string>;
  streets: Street[];
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

function parseMaxSpeed(raw: string | undefined, highway: HighwayType): number {
  if (!raw) return DEFAULT_SPEEDS[highway];
  // Handle range format like "80-110" — use the average
  if (raw.includes("-")) {
    const parts = raw.split("-").map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return (parts[0] + parts[1]) / 2;
    }
  }
  const parsed = Number(raw);
  return isNaN(parsed) ? DEFAULT_SPEEDS[highway] : parsed;
}

function parseOneway(value: string | undefined | null): "forward" | "reverse" | false {
  if (!value || value === "no" || value === "false" || value === "0") return false;
  if (value === "-1" || value === "reverse") return "reverse";
  return "forward"; // yes, true, 1
}

export class RoadNetwork extends EventEmitter {
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, Edge> = new Map();
  private roads: Map<string, Road> = new Map();
  private data: FeatureCollection;
  private heatZoneManager: HeatZoneManager = new HeatZoneManager();
  private poiNodes: Node[] | null = null;
  // Memoized POI-node sector buckets for getRandomPOINode (rebuilt-per-call before).
  private poiSectorBuckets: Node[][] | null = null;
  // Cached derived collections (the source GeoJSON is immutable after load).
  private speedLimitsCache: ReturnType<RoadNetwork["computeSpeedLimits"]> | null = null;
  private lineStringFeaturesCache: FeatureCollection | null = null;

  // Spatial grid index for O(1) nearest-node lookups
  private spatialGrid: Map<string, Node[]> = new Map();
  private gridCellSize = SPATIAL_GRID.CELL_SIZE;

  // Network bounding box for uniform spatial sampling
  private bbox = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };

  // Coarse geographic sectors for uniform spawn/destination distribution
  private sectorEdges: Edge[][] = [];
  private sectorNodes: Node[][] = [];

  // Incident-based edge cost penalties: edge ID → speedFactor (lowest wins; 0 = blocked)
  private incidentEdges: Map<string, number> = new Map();
  private _cachedIncidentFingerprint: string | null = null;

  // Maximum speed across all edges — used for admissible A* heuristic
  private maxNetworkSpeed = 110; // updated after buildNetwork

  // Precomputed static (time-invariant) per-edge base travel time (hours),
  // keyed by edge id. Computed once after the graph is fully built; the A*
  // relaxation loop adds only the dynamic incident/signal terms on top.
  private edgeBaseCost: Map<string, number> = new Map();

  // Precomputed connected-edge lookups for the movement hot path. Computed once
  // at graph-build time so `getConnectedEdges` (called every tick per vehicle)
  // does not allocate a freshly filtered array on each call.
  private connectedEdges: Map<string, Edge[]> = new Map();

  // Turn restriction table: "fromStreetId|viaNodeId" → Set of forbidden toStreetIds ("no_*")
  // or: "fromStreetId|viaNodeId" → Set of ALLOWED toStreetIds only ("only_*")
  // Type flag stored alongside: "fromStreetId|viaNodeId|type" → "prohibitory" | "mandatory"
  private turnRestrictions: Map<string, Set<string>> = new Map();
  private turnRestrictionTypes: Map<string, "prohibitory" | "mandatory"> = new Map();

  // A* route cache — avoids recomputing identical start→end routes
  private routeCache: LRUCache<Route>;

  // Worker-thread pathfinding pool (lazy-initialized)
  private pathfindingPool: PathfindingPool | null = null;
  private geojsonPath: string;

  private static readonly COORD_SNAP_EPSILON = 1e-7;

  private snapCoord(val: number): string {
    return (
      Math.round(val / RoadNetwork.COORD_SNAP_EPSILON) * RoadNetwork.COORD_SNAP_EPSILON
    ).toFixed(7);
  }

  private makeNodeKey(lat: number, lon: number): string {
    return `${this.snapCoord(lat)},${this.snapCoord(lon)}`;
  }

  constructor(geojsonPath: string, cacheOptions?: { maxSize?: number; ttlMs?: number }) {
    super();
    this.routeCache = new LRUCache<Route>({
      maxSize: cacheOptions?.maxSize ?? 500,
      ttlMs: cacheOptions?.ttlMs ?? 60_000,
      // Sliding expiry: frequently used routes stay cached
      updateAgeOnGet: true,
    });
    this.geojsonPath = geojsonPath;
    this.data = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as FeatureCollection;
    this.buildNetwork(this.data);
    this.computeBbox();
    this.buildSpatialIndex();
    this.buildSectorIndex();

    // Compute admissible heuristic bound from actual network max speed
    let maxSpeed = 0;
    for (const edge of this.edges.values()) {
      if (edge.maxSpeed > maxSpeed) maxSpeed = edge.maxSpeed;
    }
    this.maxNetworkSpeed = maxSpeed > 0 ? maxSpeed : 110;

    // Precompute static per-edge base travel times now that every node's
    // connection list (the BPR flow proxy) is fully populated.
    this.buildEdgeBaseCosts();
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
    }
  }

  private computeBbox(): void {
    for (const node of this.nodes.values()) {
      const [lat, lon] = node.coordinates;
      if (lat < this.bbox.minLat) this.bbox.minLat = lat;
      if (lat > this.bbox.maxLat) this.bbox.maxLat = lat;
      if (lon < this.bbox.minLon) this.bbox.minLon = lon;
      if (lon > this.bbox.maxLon) this.bbox.maxLon = lon;
    }
  }

  private buildSpatialIndex(): void {
    for (const node of this.nodes.values()) {
      const key = this.gridKey(node.coordinates[0], node.coordinates[1]);
      let cell = this.spatialGrid.get(key);
      if (!cell) {
        cell = [];
        this.spatialGrid.set(key, cell);
      }
      cell.push(node);
    }
  }

  private gridKey(lat: number, lon: number): string {
    const gx = Math.floor(lat / this.gridCellSize);
    const gy = Math.floor(lon / this.gridCellSize);
    return `${gx},${gy}`;
  }

  private buildSectorIndex(): void {
    // Divide the bbox into a SECTORS_N × SECTORS_N coarse grid.
    // Assign edges AND nodes to sectors by position.
    // Each occupied sector gets equal weight regardless of road density,
    // so both spawning and destination selection are geographically uniform.
    const SECTORS_N = 10;
    const { minLat, maxLat, minLon, maxLon } = this.bbox;
    const latStep = (maxLat - minLat) / SECTORS_N;
    const lonStep = (maxLon - minLon) / SECTORS_N;

    const edgeSectorMap = new Map<number, Edge[]>();
    const nodeSectorMap = new Map<number, Node[]>();

    for (const edge of this.edges.values()) {
      if (edge.start.connections.length === 0) continue;
      const [lat, lon] = edge.start.coordinates;
      const row = Math.min(Math.floor((lat - minLat) / latStep), SECTORS_N - 1);
      const col = Math.min(Math.floor((lon - minLon) / lonStep), SECTORS_N - 1);
      const key = row * SECTORS_N + col;
      let bucket = edgeSectorMap.get(key);
      if (!bucket) {
        bucket = [];
        edgeSectorMap.set(key, bucket);
      }
      bucket.push(edge);
    }

    for (const node of this.nodes.values()) {
      const [lat, lon] = node.coordinates;
      const row = Math.min(Math.floor((lat - minLat) / latStep), SECTORS_N - 1);
      const col = Math.min(Math.floor((lon - minLon) / lonStep), SECTORS_N - 1);
      const key = row * SECTORS_N + col;
      let bucket = nodeSectorMap.get(key);
      if (!bucket) {
        bucket = [];
        nodeSectorMap.set(key, bucket);
      }
      bucket.push(node);
    }

    this.sectorEdges = Array.from(edgeSectorMap.values());
    this.sectorNodes = Array.from(nodeSectorMap.values());
  }

  /**
   * Returns the bounding box of the road network computed from all node coordinates.
   *
   * @returns BoundingBox with minLat, maxLat, minLon, maxLon
   */
  public getBoundingBox(): BoundingBox {
    return { ...this.bbox };
  }

  public getAllRoads() {
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

  private getPoiType(feature: Feature): string | null {
    if (feature.properties?.amenity) {
      return feature.properties.amenity;
    }
    if (feature.properties?.shop) {
      return "shop";
    }
    if (feature.properties?.leisure) {
      return "leisure";
    }
    if (feature.properties?.craft) {
      return "craft";
    }
    if (feature.properties?.office) {
      return "office";
    }
    if (feature.properties?.highway === "bus_stop") {
      return "bus_stop";
    }
    return null;
  }
  public getAllPOIs(): Array<POI> {
    const poi: Array<POI> = [];

    for (const feature of this.data.features) {
      if (feature.geometry?.type === "Point") {
        const type = this.getPoiType(feature);
        if (type === null) {
          continue;
        }
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        poi.push({
          id: feature.properties?.id || crypto.randomUUID(),
          type: type,
          name: feature.properties?.name || null,
          coordinates: [lat, lon],
        });
      }
    }

    return poi.filter((p) => p.type !== "Unknown");
  }

  public getSpeedLimits(): Array<{
    id: string;
    speed: number;
    coordinates: [number, number];
    highway: string;
  }> {
    // Derived purely from the immutable source GeoJSON — compute once and cache.
    if (!this.speedLimitsCache) {
      this.speedLimitsCache = this.computeSpeedLimits();
    }
    return this.speedLimitsCache;
  }

  private computeSpeedLimits(): Array<{
    id: string;
    speed: number;
    coordinates: [number, number]; // [lat, lon]
    highway: string;
  }> {
    const signs: Array<{
      id: string;
      speed: number;
      coordinates: [number, number];
      highway: string;
    }> = [];

    // Deduplicate: one sign per unique (speed, roadName) combination within a sector
    const seen = new Set<string>();

    for (const feature of this.data.features) {
      if (feature.geometry?.type !== "LineString") continue;
      const props = feature.properties;
      if (!props?.maxspeed) continue;

      const speed = parseInt(props.maxspeed, 10);
      if (isNaN(speed) || speed <= 0) continue;

      const highway = props.highway || "residential";
      const coords = (feature.geometry as import("geojson").LineString).coordinates;

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

  public getPOINodes(): Node[] {
    if (this.poiNodes) return this.poiNodes;
    const pois = this.getAllPOIs();
    this.poiNodes = pois.map((poi) => this.findNearestNode(poi.coordinates));
    return this.poiNodes;
  }

  private buildNetwork(data: FeatureCollection): void {
    data.features.forEach((feature) => {
      if (feature.geometry?.type === "LineString") {
        const streetId =
          feature.properties?.id || feature.properties?.["@id"] || crypto.randomUUID();
        // Stamp the resolved streetId back onto the feature for the /network API
        feature.properties!.streetId = streetId;
        const streetName = feature.properties?.name || "";
        const streetNameEn = feature.properties?.["name:en"] || "";
        const coords = (feature.geometry as LineString).coordinates;

        // Read road metadata from GeoJSON properties
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
        const rawHighway = feature.properties?.highway || "residential";
        const highway: HighwayType = VALID_HIGHWAYS.has(rawHighway)
          ? (rawHighway as HighwayType)
          : "residential";
        const maxSpeed = parseMaxSpeed(feature.properties?.maxspeed, highway);
        const surface: string = feature.properties?.surface || "unknown";
        const onewayDir = parseOneway(feature.properties?.oneway);
        const isRoundabout = feature.properties?.junction === "roundabout";
        // Roundabouts are implicitly one-way forward regardless of the oneway tag
        const effectiveOneway = isRoundabout ? "forward" : onewayDir;
        // Apply speed reduction for roundabout segments
        const effectiveMaxSpeed = isRoundabout ? maxSpeed * 0.5 : maxSpeed;

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
              maxSpeed: effectiveMaxSpeed,
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
              maxSpeed: effectiveMaxSpeed,
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

    // Second pass: parse OSM turn restriction relations
    data.features.forEach((feature) => {
      const props = feature.properties ?? {};
      // Match relation features: osmium exports them as type=restriction features
      if (props["type"] !== "restriction" && props["@type"] !== "restriction") return;

      const fromWayId = String(props["from"] ?? props["from:way"] ?? "");
      // Snap the via node ID to match the snapped coordinate format used in the graph
      const rawVia = String(props["via"] ?? props["via:node"] ?? "");
      const viaParts = rawVia.split(",");
      const viaNodeId =
        viaParts.length === 2 && !isNaN(Number(viaParts[0])) && !isNaN(Number(viaParts[1]))
          ? this.makeNodeKey(Number(viaParts[0]), Number(viaParts[1]))
          : rawVia;
      const toWayId = String(props["to"] ?? props["to:way"] ?? "");
      const restrictionValue = String(
        props["restriction"] ?? props["restriction:motor_vehicle"] ?? ""
      );

      if (!fromWayId || !viaNodeId || !toWayId || !restrictionValue) return;

      const isProhibitory = restrictionValue.startsWith("no_");
      const isMandatory = restrictionValue.startsWith("only_");
      if (!isProhibitory && !isMandatory) return;

      const key = `${fromWayId}|${viaNodeId}`;
      const typeKey = `${key}|type`;

      if (!this.turnRestrictions.has(key)) {
        this.turnRestrictions.set(key, new Set());
        this.turnRestrictionTypes.set(typeKey, isProhibitory ? "prohibitory" : "mandatory");
      }
      this.turnRestrictions.get(key)!.add(toWayId);
    });

    // Third pass: mark traffic signal nodes
    data.features.forEach((feature) => {
      if (feature.geometry?.type === "Point") {
        const props = feature.properties ?? {};
        if (props.highway !== "traffic_signals") return;
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        const nearest = this.findNearestNode([lat, lon]);
        if (nearest) nearest.trafficSignal = true;
      }
    });
  }

  private getOrCreateNode(id: string, coordinates: [number, number]): Node {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        coordinates,
        connections: [],
      });
    }
    return this.nodes.get(id)!;
  }

  public getRandomEdge(): Edge {
    // Geographic sector normalization: pick a random occupied sector
    // (10×10 coarse grid over the bbox), then pick a random edge within it.
    // Each geographic region of the map gets equal probability regardless
    // of how many roads are in it.
    const bucket = this.sectorEdges[Math.floor(Math.random() * this.sectorEdges.length)];
    return bucket[Math.floor(Math.random() * bucket.length)];
  }

  public getRandomNode(): Node {
    // Sector-based: pick a random occupied sector, then a random node within it.
    // Gives geographic coverage proportional to area, not road density.
    const bucket = this.sectorNodes[Math.floor(Math.random() * this.sectorNodes.length)];
    return bucket[Math.floor(Math.random() * bucket.length)];
  }

  public getRandomPOINode(): Node | null {
    // Sector-based POI selection: pick a random sector that has POI nodes,
    // then pick a random POI node from it — not biased by POI density.
    const buckets = this.getPOISectorBuckets();
    if (buckets.length === 0) return null;
    const bucket = buckets[Math.floor(Math.random() * buckets.length)];
    return bucket[Math.floor(Math.random() * bucket.length)];
  }

  /**
   * POI nodes bucketed by geographic sector, computed once and memoized. The
   * POI set and bbox are fixed after graph build, so the bucketing is stable —
   * previously it was rebuilt on every getRandomPOINode call.
   */
  private getPOISectorBuckets(): Node[][] {
    if (this.poiSectorBuckets) return this.poiSectorBuckets;

    const poiNodes = this.getPOINodes();
    const { minLat, maxLat, minLon, maxLon } = this.bbox;
    const SECTORS_N = 10;
    const latStep = (maxLat - minLat) / SECTORS_N;
    const lonStep = (maxLon - minLon) / SECTORS_N;
    const poiSectors = new Map<number, Node[]>();
    for (const node of poiNodes) {
      const [lat, lon] = node.coordinates;
      const row = Math.min(Math.floor((lat - minLat) / latStep), SECTORS_N - 1);
      const col = Math.min(Math.floor((lon - minLon) / lonStep), SECTORS_N - 1);
      const key = row * SECTORS_N + col;
      let bucket = poiSectors.get(key);
      if (!bucket) {
        bucket = [];
        poiSectors.set(key, bucket);
      }
      bucket.push(node);
    }
    this.poiSectorBuckets = Array.from(poiSectors.values());
    return this.poiSectorBuckets;
  }

  /**
   * Finds the nearest road network node to a given geographic position.
   * Uses linear search with Haversine distance calculation.
   *
   * @param position - Geographic coordinates as [latitude, longitude]
   * @returns The nearest Node in the network
   * @throws {Error} If network has no nodes or node cannot be found
   *
   * @example
   * const node = network.findNearestNode([45.5017, -73.5673]);
   * console.log(node.id, node.coordinates);
   */
  public findNearestNode(position: [number, number]): Node {
    const [lat, lon] = position;
    const gx = Math.floor(lat / this.gridCellSize);
    const gy = Math.floor(lon / this.gridCellSize);

    let nearest: Node | null = null;
    let minDistance = Infinity;

    // Search expanding rings of grid cells
    for (let radius = 0; radius <= 3; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (radius > 0 && Math.abs(dx) < radius && Math.abs(dy) < radius) continue;
          const key = `${gx + dx},${gy + dy}`;
          const cell = this.spatialGrid.get(key);
          if (!cell) continue;
          for (const node of cell) {
            const distance = utils.calculateDistance(position, node.coordinates);
            if (distance < minDistance) {
              minDistance = distance;
              nearest = node;
            }
          }
        }
      }
      if (nearest) return nearest;
    }

    // Fallback to linear scan if grid search fails
    for (const node of this.nodes.values()) {
      const distance = utils.calculateDistance(position, node.coordinates);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = node;
      }
    }
    if (!nearest) throw new Error("Network has no nodes");
    return nearest;
  }

  /**
   * Finds the nearest road to a given geographic position.
   * First finds the nearest node, then returns the road containing that node.
   *
   * @param position - Geographic coordinates as [latitude, longitude]
   * @returns The nearest Road object containing the closest node
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

  public getConnectedEdges(edge: Edge): Edge[] {
    // Hot path (called every tick per vehicle): return the cached list computed
    // at graph-build time. Fall back to on-demand computation for synthetic
    // edges that are not part of the built graph (e.g. fallback U-turn edges).
    const cached = this.connectedEdges.get(edge.id);
    if (cached) return cached;
    return edge.end.connections.filter((e) => e.end.id !== edge.start.id);
  }

  // Lazily-built cache of synthetic "U-turn" fallback edges (one per real edge),
  // used by movement when a dead-end edge has no connected edges. Reusing the
  // cached object avoids spread-synthesizing a fresh Edge on the per-tick hot
  // path. Lazy (not built upfront) since only dead-end edges ever need one.
  private fallbackEdges: Map<string, Edge> = new Map();

  /**
   * Returns the synthetic reverse ("U-turn") edge for a dead-end edge — the
   * same object the movement code previously rebuilt via spread every tick.
   * Cached per edge so the hot path allocates nothing after first use.
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
   * Finds the shortest route between two nodes using A* pathfinding algorithm.
   * Returns null if no route exists between the nodes.
   *
   * @param start - Starting node for the route
   * @param end - Destination node for the route
   * @returns Route object with edges and total distance, or null if no path exists
   *
   * @example
   * const route = network.findRoute(startNode, endNode);
   * if (route) {
   *   console.log(`Route distance: ${route.distance}km`);
   *   console.log(`Number of edges: ${route.edges.length}`);
   * }
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

    gScore.set(start.id, 0);
    const initialH = this.calculateHeuristic(start, end);
    heap.push({ id: start.id, gScore: 0, fScore: initialH });

    while (heap.size > 0) {
      const current = heap.pop();

      if (closedSet.has(current.id)) continue;

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

  /** Expose turn restrictions for testing. Returns a shallow copy of the map. */
  public getTurnRestrictions(): Map<string, Set<string>> {
    return new Map(this.turnRestrictions);
  }

  /** Clear all cached routes. Useful for testing or when the network topology changes. */
  public clearRouteCache(): void {
    this.routeCache.clear();
  }

  /**
   * Compute a lightweight fingerprint of the current incident edges for cache keying.
   * Includes the speed factor per edge so a factor change on the same edge set
   * (e.g. one of two overlapping incidents clearing) invalidates cached routes.
   */
  private incidentFingerprint(): string {
    if (this._cachedIncidentFingerprint !== null) return this._cachedIncidentFingerprint;
    if (this.incidentEdges.size === 0) {
      this._cachedIncidentFingerprint = "";
    } else {
      this._cachedIncidentFingerprint = Array.from(this.incidentEdges.entries())
        .map(([id, factor]) => `${id}:${factor}`)
        .sort()
        .join(",");
    }
    return this._cachedIncidentFingerprint;
  }

  /** Replace incident edge speed factors. Cache invalidation is handled by the fingerprint key. */
  public setIncidentEdges(edgeSpeedFactors: Map<string, number>): void {
    this.incidentEdges = edgeSpeedFactors;
    this._cachedIncidentFingerprint = null;
  }

  /** Clear all incident edge data. Cache invalidation is handled by the fingerprint key. */
  public clearIncidentEdges(): void {
    this.incidentEdges.clear();
    this._cachedIncidentFingerprint = null;
  }

  /** Return hit/miss statistics for the route cache. */
  public routeCacheStats(): CacheStats {
    return this.routeCache.stats();
  }

  /**
   * Looks up an edge by its ID.
   */
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
    const cacheKey = `${start.id}|${end.id}|${this.incidentFingerprint()}|${highwayKey}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached) return { edges: [...cached.edges], distance: cached.distance };

    // Lazy-init the pool on first async call
    if (!this.pathfindingPool) {
      this.pathfindingPool = new PathfindingPool(this.geojsonPath);
    }

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
      this.incidentEdges.size > 0 ? this.incidentEdges : undefined,
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
    this.routeCache.set(cacheKey, route);
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

    return {
      edges: reversedPath,
      distance: totalDistance,
    };
  }

  private calculateHeuristic(from: Node, to: Node): number {
    // Optimistic estimate: straight-line distance at max possible speed in this network
    return utils.calculateDistance(from.coordinates, to.coordinates) / this.maxNetworkSpeed;
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

  public getFeatures(): FeatureCollection {
    // The LineString-only view is derived from the immutable source GeoJSON;
    // compute it once and cache (previously re-filtered on every /network call).
    if (!this.lineStringFeaturesCache) {
      this.lineStringFeaturesCache = {
        ...this.data,
        // remove the points of interest
        features: this.data.features.filter((feature) => feature.geometry?.type === "LineString"),
      };
    }
    return this.lineStringFeaturesCache;
  }
}

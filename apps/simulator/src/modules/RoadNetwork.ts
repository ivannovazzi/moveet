import fs from "fs";
import crypto from "crypto";
import type { Feature, FeatureCollection, LineString } from "geojson";
import type { Node, Edge, Route, PathNode, HeatZoneFeature, POI, HighwayType } from "../types";
import * as utils from "../utils/helpers";
import { HeatZoneManager } from "./HeatZoneManager";
import EventEmitter from "events";

type Street = [number, number][];
interface Road {
  name: string;
  nodeIds: Set<string>;
  streets: Street[];
}

const DEFAULT_SPEEDS: Record<HighwayType, number> = {
  motorway: 110,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
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

export class RoadNetwork extends EventEmitter {
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, Edge> = new Map();
  private roads: Map<string, Road> = new Map();
  private data: FeatureCollection;
  private heatZoneManager: HeatZoneManager = new HeatZoneManager();
  private poiNodes: Node[] | null = null;

  // Spatial grid index for O(1) nearest-node lookups
  private spatialGrid: Map<string, Node[]> = new Map();
  private gridCellSize = 0.005; // ~500m cells in degrees

  // Network bounding box for uniform spatial sampling
  private bbox = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };

  // Coarse geographic sectors for uniform spawn/destination distribution
  private sectorEdges: Edge[][] = [];
  private sectorNodes: Node[][] = [];

  constructor(geojsonPath: string) {
    super();
    this.data = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as FeatureCollection;
    this.buildNetwork(this.data);
    this.computeBbox();
    this.buildSpatialIndex();
    this.buildSectorIndex();
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
      if (!bucket) { bucket = []; edgeSectorMap.set(key, bucket); }
      bucket.push(edge);
    }

    for (const node of this.nodes.values()) {
      const [lat, lon] = node.coordinates;
      const row = Math.min(Math.floor((lat - minLat) / latStep), SECTORS_N - 1);
      const col = Math.min(Math.floor((lon - minLon) / lonStep), SECTORS_N - 1);
      const key = row * SECTORS_N + col;
      let bucket = nodeSectorMap.get(key);
      if (!bucket) { bucket = []; nodeSectorMap.set(key, bucket); }
      bucket.push(node);
    }

    this.sectorEdges = Array.from(edgeSectorMap.values());
    this.sectorNodes = Array.from(nodeSectorMap.values());
  }

  public getAllRoads(): Road[] {
    return Array.from(this.roads.values());
  }

  private getPoiType(feature: Feature): string | null {
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
      if (feature.geometry.type === "Point") {
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

  public getPOINodes(): Node[] {
    if (this.poiNodes) return this.poiNodes;
    const pois = this.getAllPOIs();
    this.poiNodes = pois.map((poi) => this.findNearestNode(poi.coordinates));
    return this.poiNodes;
  }

  private buildNetwork(data: FeatureCollection): void {
    data.features.forEach((feature) => {
      if (feature.geometry.type === "LineString") {
        const streetId = feature.properties?.id || crypto.randomUUID();
        const streetName = feature.properties?.name || "";
        const coords = (feature.geometry as LineString).coordinates;

        // Read road metadata from GeoJSON properties
        const VALID_HIGHWAYS = new Set<string>([
          "motorway",
          "trunk",
          "primary",
          "secondary",
          "tertiary",
          "residential",
        ]);
        const rawHighway = feature.properties?.highway || "residential";
        const highway: HighwayType = VALID_HIGHWAYS.has(rawHighway)
          ? (rawHighway as HighwayType)
          : "residential";
        const maxSpeed = parseMaxSpeed(feature.properties?.maxspeed, highway);
        const surface: string = feature.properties?.surface || "unknown";
        const isOneway = feature.properties?.oneway === "yes";

        // Initialize or get existing road
        if (!this.roads.has(streetName)) {
          this.roads.set(streetName, {
            name: streetName,
            nodeIds: new Set<string>(),
            streets: [],
          });
        }
        const road = this.roads.get(streetName)!;

        road.streets.push(coords as Street);
        // Build edges
        for (let i = 0; i < coords.length - 1; i++) {
          const [lon1, lat1] = coords[i];
          const [lon2, lat2] = coords[i + 1];

          const node1 = this.getOrCreateNode(`${lat1},${lon1}`, [lat1, lon1]);
          const node2 = this.getOrCreateNode(`${lat2},${lon2}`, [lat2, lon2]);

          road.nodeIds.add(node1.id);
          road.nodeIds.add(node2.id);

          const distance = utils.calculateDistance(node1.coordinates, node2.coordinates);
          const bearing = utils.calculateBearing(node1.coordinates, node2.coordinates);

          const forwardEdge: Edge = {
            id: `${node1.id}-${node2.id}`,
            streetId,
            start: node1,
            end: node2,
            distance,
            bearing,
            name: streetName,
            highway,
            maxSpeed,
            surface,
            oneway: isOneway,
          };

          this.edges.set(forwardEdge.id, forwardEdge);
          node1.connections.push(forwardEdge);

          if (!isOneway) {
            const reverseEdge: Edge = {
              id: `${node2.id}-${node1.id}`,
              streetId,
              start: node2,
              end: node1,
              distance,
              bearing: (bearing + 180) % 360,
              name: streetName,
              highway,
              maxSpeed,
              surface,
              oneway: false,
            };

            this.edges.set(reverseEdge.id, reverseEdge);
            node2.connections.push(reverseEdge);
          }
        }
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
    const poiNodes = this.getPOINodes();
    if (poiNodes.length === 0) return null;

    // Bucket POI nodes by sector
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
      if (!bucket) { bucket = []; poiSectors.set(key, bucket); }
      bucket.push(node);
    }
    const buckets = Array.from(poiSectors.values());
    const bucket = buckets[Math.floor(Math.random() * buckets.length)];
    return bucket[Math.floor(Math.random() * bucket.length)];
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
    return edge.end.connections.filter((e) => e.end.id !== edge.start.id);
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
    const closedSet = new Set<string>();
    const cameFrom = new Map<string, { prevId: string; edge: Edge }>();
    const gScore = new Map<string, number>();

    // Min-heap for O(log n) extraction instead of O(n) linear scan
    const heap: PathNode[] = [];
    const inOpen = new Set<string>();

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
          const left = 2 * i + 1,
            right = 2 * i + 2;
          if (left < heap.length && heap[left].fScore < heap[smallest].fScore) smallest = left;
          if (right < heap.length && heap[right].fScore < heap[smallest].fScore) smallest = right;
          if (smallest === i) break;
          [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
          i = smallest;
        }
      }
      return top;
    };

    gScore.set(start.id, 0);
    const initialH = this.calculateHeuristic(start, end);
    pushHeap({ id: start.id, gScore: 0, fScore: initialH });
    inOpen.add(start.id);

    while (heap.length > 0) {
      const current = popHeap();
      inOpen.delete(current.id);

      if (closedSet.has(current.id)) continue;

      if (current.id === end.id) {
        return this.reconstructPath(start.id, end.id, cameFrom);
      }

      closedSet.add(current.id);
      const currentNode = this.nodes.get(current.id)!;

      for (const edge of currentNode.connections) {
        if (closedSet.has(edge.end.id)) continue;

        const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
        const travelTime = (edge.distance / edge.maxSpeed) * surfacePenalty;
        const tentativeCost = current.gScore + travelTime;
        const existingCost = gScore.get(edge.end.id);

        if (!existingCost || tentativeCost < existingCost) {
          cameFrom.set(edge.end.id, { prevId: current.id, edge });
          gScore.set(edge.end.id, tentativeCost);

          const h = this.calculateHeuristic(edge.end, end);
          const f = tentativeCost + h;
          pushHeap({ id: edge.end.id, gScore: tentativeCost, fScore: f });
          inOpen.add(edge.end.id);
        }
      }
    }
    return null;
  }

  private reconstructPath(
    startId: string,
    endId: string,
    cameFrom: Map<string, { prevId: string; edge: Edge }>
  ): Route {
    const path: Edge[] = [];
    let currentId = endId;
    let totalDistance = 0;

    while (currentId !== startId) {
      const { prevId, edge } = cameFrom.get(currentId)!;
      path.unshift(edge);
      totalDistance += edge.distance;
      currentId = prevId;
    }

    return {
      edges: path,
      distance: totalDistance,
    };
  }

  private calculateHeuristic(from: Node, to: Node): number {
    // Optimistic estimate: straight-line distance at max possible speed (110 km/h)
    return utils.calculateDistance(from.coordinates, to.coordinates) / 110;
  }

  public searchByName(query: string): Array<{
    name: string;
    nodeIds: string[];
    coordinates: [number, number][];
  }> {
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      name: string;
      nodeIds: string[];
      coordinates: [number, number][];
    }> = [];

    for (const [name, road] of this.roads) {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: road.name,
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
    return {
      ...this.data,
      // remove the points of interest
      features: this.data.features.filter((feature) => feature.geometry.type === "LineString"),
    };
  }
}

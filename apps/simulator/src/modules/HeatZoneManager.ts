import { point, destination, distance, lineString, bezierSpline } from "@turf/turf";
import crypto from "crypto";
import type { Edge, Node, HeatZone, HeatZoneFeature } from "../types";
import { SPATIAL_GRID, HEAT_ZONE_DEFAULTS } from "../constants";
import logger from "../utils/logger";

/**
 * Thrown by `addZone` when the total-zone cap (`HEAT_ZONE_DEFAULTS.MAX_TOTAL`)
 * is already reached. Carries a stable `code` so routes can map it to an HTTP
 * 409 without depending on the message text.
 */
export class HeatZoneCapError extends Error {
  public readonly code = "HEATZONE_CAP_REACHED";
  constructor(max: number) {
    super(`Heat zone limit reached (max ${max}). Delete an existing zone before adding a new one.`);
    this.name = "HeatZoneCapError";
  }
}

export class HeatZoneManager {
  private zones: HeatZone[] = [];

  // Spatial grid index: maps "row,col" cell keys to zones whose bounding box overlaps that cell.
  // Cuts isPositionInHeatZone from O(zones) ray-casts to O(candidates) where candidates is
  // typically 0-1 for most positions on the map.
  private spatialGrid: Map<string, HeatZone[]> = new Map();
  private static readonly GRID_CELL_SIZE = SPATIAL_GRID.CELL_SIZE;

  constructor() {}

  /**
   * Gets all currently generated heat zones.
   *
   * @returns Array of heat zones with polygons, intensities, and timestamps
   */
  public getZones(): HeatZone[] {
    return this.zones;
  }

  /**
   * Generates heat zones around high-traffic intersections on the road network.
   * Zones are placed at intersections with 3+ connections, weighted by connection count.
   * Each zone has an irregular polygon shape smoothed with Bezier curves.
   *
   * @param edges - Road network edges (used for context)
   * @param nodes - Road network nodes to place zones at
   * @param options - Configuration options for zone generation
   * @param options.count - Number of zones to generate (default: 5)
   * @param options.minRadius - Minimum zone radius in km (default: 0.1)
   * @param options.maxRadius - Maximum zone radius in km (default: 1)
   * @param options.minIntensity - Minimum intensity from 0-1 (default: 0.2)
   * @param options.maxIntensity - Maximum intensity from 0-1 (default: 1)
   * @param options.maxAttempts - Maximum placement attempts per zone (default: 10)
   *
   * @example
   * heatZoneManager.generateHeatedZones(edges, nodes, {
   *   count: 10,
   *   minRadius: 0.2,
   *   maxRadius: 0.5,
   *   minIntensity: 0.3
   * });
   */
  public generateHeatedZones(
    _edges: Edge[],
    nodes: Node[],
    options: {
      count?: number;
      minRadius?: number;
      maxRadius?: number;
      minIntensity?: number;
      maxIntensity?: number;
      maxAttempts?: number; // maximum tries if region overlaps
    } = {}
  ): void {
    const {
      count = 5,
      minRadius = 0.1,
      maxRadius = 1,
      minIntensity = 0.2,
      maxIntensity = 1,
      maxAttempts = 10,
    } = options;

    // No usable nodes: append nothing and leave existing zones untouched.
    if (nodes.length === 0) {
      return;
    }

    // Cap total zones: append only up to the remaining capacity (no error).
    const capacity = Math.max(0, HEAT_ZONE_DEFAULTS.MAX_TOTAL - this.zones.length);
    const target = Math.min(count, capacity);
    if (target === 0) {
      return;
    }

    const intersectionNodes = nodes.filter((n) => n.connections.length >= 3);
    const pool = intersectionNodes.length ? intersectionNodes : nodes;
    const items = pool.map((n) => ({
      node: n,
      weight: n.connections.length,
    }));
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);

    const newZones: HeatZoneFeature[] = [];
    let attempts = 0;
    while (newZones.length < target && attempts < target * maxAttempts) {
      attempts++;
      const picked = this.pickNodeByWeight(items, totalWeight);
      const center: [number, number] = [picked.coordinates[0], picked.coordinates[1]];

      const radiusScale = Math.max(1, picked.connections.length / 2);
      const radius = (minRadius + Math.random() * (maxRadius - minRadius)) * radiusScale;
      const intensity = minIntensity + Math.random() * (maxIntensity - minIntensity);

      const vertices = this.generateIrregularPolygon(center, radius);
      const candidateZone: HeatZoneFeature = {
        type: "Feature",
        properties: {
          id: crypto.randomUUID(),
          intensity,
          timestamp: new Date().toISOString(),
          radius,
        },
        geometry: {
          type: "Polygon",
          coordinates: vertices as [number, number][],
        },
      };

      newZones.push(candidateZone);
    }

    // APPEND generated zones to any existing (drawn or previously-seeded)
    // zones instead of replacing them, and index each new zone into the grid.
    const generated: HeatZone[] = this.smoothPolygons(newZones).map((zone) => ({
      id: zone.properties.id,
      polygon: zone.geometry.coordinates,
      intensity: zone.properties.intensity,
      timestamp: zone.properties.timestamp,
      radius: this.deriveRadius(zone.geometry.coordinates),
    }));

    for (const zone of generated) {
      this.zones.push(zone);
      this.indexZone(zone);
    }
  }

  // ─── Manual CRUD ────────────────────────────────────────────────────

  /**
   * Adds a single manually-drawn zone. Assigns a stable id (unless one is
   * supplied) and a creation timestamp, indexes it into the spatial grid, and
   * returns the exported GeoJSON feature.
   */
  public addZone(input: { polygon: number[][]; intensity: number; id?: string }): HeatZoneFeature {
    if (this.zones.length >= HEAT_ZONE_DEFAULTS.MAX_TOTAL) {
      throw new HeatZoneCapError(HEAT_ZONE_DEFAULTS.MAX_TOTAL);
    }
    const zone: HeatZone = {
      id: input.id ?? crypto.randomUUID(),
      polygon: input.polygon,
      intensity: input.intensity,
      timestamp: new Date().toISOString(),
      radius: this.deriveRadius(input.polygon),
    };
    this.zones.push(zone);
    this.indexZone(zone);
    return this.zoneToFeature(zone);
  }

  /**
   * Updates a zone's geometry and/or intensity. Re-indexes the spatial grid
   * only when the geometry changes. Returns the updated feature, or null if no
   * zone has the given id.
   */
  public updateZone(
    id: string,
    patch: { polygon?: number[][]; intensity?: number }
  ): HeatZoneFeature | null {
    const zone = this.getZoneById(id);
    if (!zone) return null;

    const geometryChanged = patch.polygon !== undefined;
    if (geometryChanged) this.deindexZone(zone);

    if (patch.polygon !== undefined) {
      zone.polygon = patch.polygon;
      zone.radius = this.deriveRadius(patch.polygon);
    }
    if (patch.intensity !== undefined) zone.intensity = patch.intensity;

    if (geometryChanged) this.indexZone(zone);
    return this.zoneToFeature(zone);
  }

  /**
   * Removes a zone (and its grid entries) by id. Returns whether it existed.
   */
  public removeZone(id: string): boolean {
    const index = this.zones.findIndex((z) => z.id === id);
    if (index === -1) return false;
    const [zone] = this.zones.splice(index, 1);
    this.deindexZone(zone);
    return true;
  }

  /**
   * Removes every zone and empties the spatial grid.
   */
  public clearZones(): void {
    this.zones = [];
    this.spatialGrid.clear();
  }

  /**
   * Finds a zone by its id, or undefined if none matches.
   */
  public getZoneById(id: string): HeatZone | undefined {
    return this.zones.find((z) => z.id === id);
  }

  /**
   * Exports heat zones as encoded polyline paths for efficient transmission.
   * Uses Google's polyline encoding algorithm.
   *
   * @returns Array of encoded polyline strings, one per heat zone
   */
  public exportHeatedZonesAsPaths(): string[] {
    return this.zones.map((zone) => this.polygonToPath(zone.polygon));
  }

  /**
   * Exports heat zones as GeoJSON features for mapping applications.
   * Each feature includes zone metadata (intensity, timestamp) as properties.
   *
   * @returns Array of GeoJSON Feature objects with Polygon geometries
   *
   * @example
   * const features = heatZoneManager.exportHeatedZonesAsFeatures();
   * const geojson = { type: 'FeatureCollection', features };
   */
  public exportHeatedZonesAsFeatures(): HeatZoneFeature[] {
    return this.zones.map((zone) => this.zoneToFeature(zone));
  }

  /**
   * Converts an internal zone to its wire-format GeoJSON feature. The id is the
   * zone's own stable id (a fresh uuid is only minted as a fallback for legacy
   * zones with no id). `radius` is derived from the polygon bbox for
   * wire-compat / the spatial grid.
   */
  private zoneToFeature(zone: HeatZone): HeatZoneFeature {
    return {
      type: "Feature",
      properties: {
        id: zone.id ?? crypto.randomUUID(),
        intensity: zone.intensity,
        timestamp: zone.timestamp,
        // Cached on add / geometry-change; only legacy or test-injected zones
        // (no cached radius) fall back to recomputing the haversine here.
        radius: zone.radius ?? this.deriveRadius(zone.polygon),
      },
      geometry: {
        type: "Polygon",
        coordinates: zone.polygon as [number, number][],
      },
    };
  }

  /**
   * Derives a representative radius (km) for a polygon: roughly half the
   * diagonal of its bounding box. Kept for wire-compat and coarse sizing.
   */
  private deriveRadius(polygon: number[][]): number {
    const bbox = this.polygonBBox(polygon);
    if (!bbox) return 0;
    const diagonalKm = distance(
      point([bbox.minLon, bbox.minLat]),
      point([bbox.maxLon, bbox.maxLat]),
      { units: "kilometers" }
    );
    return diagonalKm / 2;
  }

  /**
   * Checks if a geographic position is inside any heat zone.
   * Uses point-in-polygon algorithm for accurate detection.
   *
   * @param position - Geographic coordinates as [latitude, longitude]
   * @returns True if position is inside any heat zone, false otherwise
   *
   * @example
   * const isInZone = heatZoneManager.isPositionInHeatZone([45.5017, -73.5673]);
   * if (isInZone) console.log('Vehicle is in a heat zone!');
   */
  public isPositionInHeatZone(position: [number, number]): boolean {
    const px = position[1]; // longitude
    const py = position[0]; // latitude
    const candidates = this.getCandidateZones(position);
    return candidates.some((zone) => this.raycastPIP(px, py, zone.polygon));
  }

  /**
   * Computes a polygon's bounding box. Coords are [longitude, latitude]
   * (GeoJSON convention). Returns null for an empty polygon.
   */
  private polygonBBox(
    polygon: number[][]
  ): { minLon: number; maxLon: number; minLat: number; maxLat: number } | null {
    if (polygon.length === 0) return null;
    let minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const coord of polygon) {
      const lon = coord[0];
      const lat = coord[1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { minLon, maxLon, minLat, maxLat };
  }

  /**
   * Invokes `fn` for every grid cell key overlapped by the zone's bounding box.
   */
  private forEachZoneCell(zone: HeatZone, fn: (key: string) => void): void {
    const bbox = this.polygonBBox(zone.polygon);
    if (!bbox) return;
    const cellSize = HeatZoneManager.GRID_CELL_SIZE;
    const minRow = Math.floor(bbox.minLat / cellSize);
    const maxRow = Math.floor(bbox.maxLat / cellSize);
    const minCol = Math.floor(bbox.minLon / cellSize);
    const maxCol = Math.floor(bbox.maxLon / cellSize);

    // Defense-in-depth: a pathological polygon (e.g. coordinates in the wrong
    // projection that slipped past schema validation) can span tens of millions
    // of cells, and the nested loop below would freeze the event loop for every
    // client. Skip indexing such a zone rather than iterating it.
    const cellCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    if (cellCount > SPATIAL_GRID.MAX_ZONE_CELLS) {
      logger.warn(
        `Heat zone ${zone.id ?? "(no id)"} spans ${cellCount} grid cells (> ${SPATIAL_GRID.MAX_ZONE_CELLS}); skipping spatial indexing. Check its coordinates are valid WGS84 [lng, lat].`
      );
      return;
    }

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        fn(`${row},${col}`);
      }
    }
  }

  /**
   * Inserts a single zone into every grid cell its bounding box overlaps.
   */
  private indexZone(zone: HeatZone): void {
    this.forEachZoneCell(zone, (key) => {
      let cell = this.spatialGrid.get(key);
      if (!cell) {
        cell = [];
        this.spatialGrid.set(key, cell);
      }
      cell.push(zone);
    });
  }

  /**
   * Removes a single zone from every grid cell its bounding box overlaps,
   * dropping any cell that becomes empty.
   */
  private deindexZone(zone: HeatZone): void {
    this.forEachZoneCell(zone, (key) => {
      const cell = this.spatialGrid.get(key);
      if (!cell) return;
      const idx = cell.indexOf(zone);
      if (idx !== -1) cell.splice(idx, 1);
      if (cell.length === 0) this.spatialGrid.delete(key);
    });
  }

  /**
   * Computes the grid cell key for a given lat/lon position.
   * Uses latitude for rows and longitude for columns.
   */
  private getGridKey(lat: number, lon: number): string {
    const cellSize = HeatZoneManager.GRID_CELL_SIZE;
    const row = Math.floor(lat / cellSize);
    const col = Math.floor(lon / cellSize);
    return `${row},${col}`;
  }

  /**
   * Returns only the heat zones whose bounding box overlaps the grid cell
   * containing the given position. Most positions will return an empty array,
   * avoiding all ray-casting work.
   */
  private getCandidateZones(position: [number, number]): HeatZone[] {
    const key = this.getGridKey(position[0], position[1]);
    return this.spatialGrid.get(key) || [];
  }

  private raycastPIP(px: number, py: number, polygon: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0],
        yi = polygon[i][1];
      const xj = polygon[j][0],
        yj = polygon[j][1];
      const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private generateIrregularPolygon(center: [number, number], radius: number): number[][] {
    const points = 12;
    const vertices: number[][] = [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const jitter = 0.7 + Math.random() * 0.6;
      const distance = radius * jitter;
      const dest = destination(point([center[1], center[0]]), distance, (angle * 180) / Math.PI);
      vertices.push(dest.geometry.coordinates);
    }
    vertices.push(vertices[0]);
    return vertices;
  }

  private smoothPolygons(zones: HeatZoneFeature[]): HeatZoneFeature[] {
    return zones.map((zone) => {
      const line = lineString(zone.geometry.coordinates);
      const smoothed = bezierSpline(line);
      return {
        ...zone,
        geometry: {
          type: "Polygon",
          coordinates: smoothed.geometry.coordinates as [number, number][],
        },
      };
    });
  }

  private polygonToPath(polygon: number[][]): string {
    if (polygon.length === 0) return "";

    const encode = (current: number, previous: number) => {
      const coord = Math.round(current * 1e5);
      const prev = Math.round(previous * 1e5);
      const coord1 = coord - prev;
      let coord2 = (coord1 << 1) ^ (coord1 >> 31);
      let str = "";
      while (coord2 >= 0x20) {
        str += String.fromCharCode((0x20 | (coord2 & 0x1f)) + 63);
        coord2 >>= 5;
      }
      str += String.fromCharCode(coord2 + 63);
      return str;
    };

    let path = "";
    let prevLat = 0;
    let prevLng = 0;

    for (const [lng, lat] of polygon) {
      path += encode(lat, prevLat);
      path += encode(lng, prevLng);
      prevLat = lat;
      prevLng = lng;
    }
    return path;
  }

  // Choose a node at random weighted by connections
  private pickNodeByWeight(
    items: Array<{ node: Node; weight: number }>,
    totalWeight: number
  ): Node {
    let r = Math.random() * totalWeight;
    for (const item of items) {
      if (r < item.weight) return item.node;
      r -= item.weight;
    }
    // Fallback
    return items[items.length - 1].node;
  }
}

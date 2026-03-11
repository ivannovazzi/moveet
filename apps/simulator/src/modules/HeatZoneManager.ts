import { point, destination, lineString, bezierSpline } from "@turf/turf";
import crypto from "crypto";
import type { Edge, Node, HeatZone, HeatZoneFeature } from "../types";

export class HeatZoneManager {
  private zones: HeatZone[] = [];

  // Spatial grid index: maps "row,col" cell keys to zones whose bounding box overlaps that cell.
  // Cuts isPositionInHeatZone from O(zones) ray-casts to O(candidates) where candidates is
  // typically 0-1 for most positions on the map.
  private spatialGrid: Map<string, HeatZone[]> = new Map();
  private static readonly GRID_CELL_SIZE = 0.005; // ~500m in degrees, matches RoadNetwork grid

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

    if (nodes.length === 0) {
      this.zones = [];
      this.buildSpatialGrid();
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
    while (newZones.length < count && attempts < count * maxAttempts) {
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

    this.zones = this.smoothPolygons(newZones).map((zone) => ({
      polygon: zone.geometry.coordinates,
      intensity: zone.properties.intensity,
      timestamp: zone.properties.timestamp,
    }));

    this.buildSpatialGrid();
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
    return this.zones.map((zone) => ({
      type: "Feature",
      properties: {
        id: crypto.randomUUID(),
        intensity: zone.intensity,
        timestamp: zone.timestamp,
        radius: 0,
      },
      geometry: {
        type: "Polygon",
        coordinates: zone.polygon as [number, number][],
      },
    }));
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
   * Builds the spatial grid index from the current zones.
   * For each zone, computes its bounding box and inserts the zone into every
   * grid cell that the bounding box overlaps.
   */
  private buildSpatialGrid(): void {
    this.spatialGrid.clear();

    for (const zone of this.zones) {
      const polygon = zone.polygon;
      if (polygon.length === 0) continue;

      // Compute bounding box of polygon.
      // Polygon coords are [longitude, latitude] (GeoJSON convention).
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

      // Map bounding box to grid cell range
      const cellSize = HeatZoneManager.GRID_CELL_SIZE;
      const minRow = Math.floor(minLat / cellSize);
      const maxRow = Math.floor(maxLat / cellSize);
      const minCol = Math.floor(minLon / cellSize);
      const maxCol = Math.floor(maxLon / cellSize);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const key = `${row},${col}`;
          let cell = this.spatialGrid.get(key);
          if (!cell) {
            cell = [];
            this.spatialGrid.set(key, cell);
          }
          cell.push(zone);
        }
      }
    }
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

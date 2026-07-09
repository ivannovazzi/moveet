/**
 * Spatial indexing for the road network: a uniform grid for O(1)-ish
 * nearest-node lookups, a coarse sector grid for geographically uniform
 * random spawn/destination selection, and POI-node bucketing.
 *
 * Extracted from RoadNetwork (architecture review #6). It holds references to
 * the graph's `nodes` and `edges` Maps (NOT copies) so that the facade and the
 * index see the same node set; this preserves the existing behaviour where
 * clearing the network's node Map makes nearest-node queries fail.
 */

import type { Node, Edge, POI, BoundingBox } from "../../types";
import * as utils from "../../utils/helpers";
import { SPATIAL_GRID } from "../../constants";
import { rng } from "../../utils/rng";
import { config } from "../../utils/config";

const SECTORS_N = config.sectorsN;

export class SpatialIndex {
  private readonly nodes: Map<string, Node>;
  private readonly edges: Map<string, Edge>;
  private readonly pois: POI[];

  private gridCellSize = SPATIAL_GRID.CELL_SIZE;
  private spatialGrid: Map<string, Node[]> = new Map();

  private bbox = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };

  private sectorEdges: Edge[][] = [];
  private sectorNodes: Node[][] = [];

  // POI nodes + their sector buckets, memoized on first use.
  private poiNodes: Node[] | null = null;
  private poiSectorBuckets: Node[][] | null = null;

  constructor(nodes: Map<string, Node>, edges: Map<string, Edge>, pois: POI[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.pois = pois;
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

  private gridKey(lat: number, lon: number): string {
    const gx = Math.floor(lat / this.gridCellSize);
    const gy = Math.floor(lon / this.gridCellSize);
    return `${gx},${gy}`;
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

  private buildSectorIndex(): void {
    // Divide the bbox into a SECTORS_N × SECTORS_N coarse grid.
    // Assign edges AND nodes to sectors by position.
    // Each occupied sector gets equal weight regardless of road density,
    // so both spawning and destination selection are geographically uniform.
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

  public getBoundingBox(): BoundingBox {
    return { ...this.bbox };
  }

  public getRandomEdge(): Edge {
    // Geographic sector normalization: pick a random occupied sector
    // (10×10 coarse grid over the bbox), then pick a random edge within it.
    const bucket = this.sectorEdges[Math.floor(rng() * this.sectorEdges.length)];
    return bucket[Math.floor(rng() * bucket.length)];
  }

  public getRandomNode(): Node {
    // Sector-based: pick a random occupied sector, then a random node within it.
    const bucket = this.sectorNodes[Math.floor(rng() * this.sectorNodes.length)];
    return bucket[Math.floor(rng() * bucket.length)];
  }

  public getRandomPOINode(): Node | null {
    const buckets = this.getPOISectorBuckets();
    if (buckets.length === 0) return null;
    const bucket = buckets[Math.floor(rng() * buckets.length)];
    return bucket[Math.floor(rng() * bucket.length)];
  }

  /**
   * POI nodes (nearest graph node to each POI), memoized on first use. The POI
   * set and graph are fixed after build, so this is computed once.
   */
  public getPOINodes(): Node[] {
    if (this.poiNodes) return this.poiNodes;
    this.poiNodes = this.pois.map((poi) => this.findNearestNode(poi.coordinates));
    return this.poiNodes;
  }

  /**
   * POI nodes bucketed by geographic sector, computed once and memoized.
   */
  private getPOISectorBuckets(): Node[][] {
    if (this.poiSectorBuckets) return this.poiSectorBuckets;

    const poiNodes = this.getPOINodes();
    const { minLat, maxLat, minLon, maxLon } = this.bbox;
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
   * Uses an expanding grid-ring search, falling back to a linear scan.
   *
   * @param position - Geographic coordinates as [latitude, longitude]
   * @returns The nearest Node in the network
   * @throws {Error} If network has no nodes
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
}

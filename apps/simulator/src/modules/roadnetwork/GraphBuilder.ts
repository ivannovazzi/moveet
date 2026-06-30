/**
 * Builds the road-network graph (nodes, edges, roads, connected-edge lookups,
 * per-edge base costs, turn restrictions) from a GeoJSON FeatureCollection, and
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
import { computeBaseTravelTime } from "../pathfinding/cost";
import {
  type Road,
  type Street,
  parseSmoothness,
  parseMaxSpeed,
  parseOneway,
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
  turnRestrictions: Map<string, Set<string>>;
  turnRestrictionTypes: Map<string, "prohibitory" | "mandatory">;
  maxNetworkSpeed: number;
  /** Eagerly-extracted POIs (Point features). */
  pois: POI[];
  /** Eagerly-extracted speed-limit signs derived from LineString maxspeed tags. */
  speedLimits: SpeedLimitSign[];
  /** LineString-only feature collection (the /network view), with streetId stamped. */
  lineStringFeatures: FeatureCollection;
}

const COORD_SNAP_EPSILON = 1e-7;

export class GraphBuilder {
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, Edge> = new Map();
  private roads: Map<string, Road> = new Map();
  private edgeBaseCost: Map<string, number> = new Map();
  private connectedEdges: Map<string, Edge[]> = new Map();
  private turnRestrictions: Map<string, Set<string>> = new Map();
  private turnRestrictionTypes: Map<string, "prohibitory" | "mandatory"> = new Map();

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

    let maxSpeed = 0;
    for (const edge of this.edges.values()) {
      if (edge.maxSpeed > maxSpeed) maxSpeed = edge.maxSpeed;
    }
    const maxNetworkSpeed = maxSpeed > 0 ? maxSpeed : 110;

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
      turnRestrictions: this.turnRestrictions,
      turnRestrictionTypes: this.turnRestrictionTypes,
      maxNetworkSpeed,
      pois,
      speedLimits,
      lineStringFeatures,
    };
  }

  private buildGraph(data: FeatureCollection): void {
    data.features.forEach((feature) => {
      if (feature.geometry?.type === "LineString") {
        const streetId =
          feature.properties?.id || feature.properties?.["@id"] || crypto.randomUUID();
        // Stamp the resolved streetId back onto the feature for the /network API
        feature.properties!.streetId = streetId;
        const streetName = feature.properties?.name || "";
        const streetNameEn = feature.properties?.["name:en"] || "";
        const coords = (feature.geometry as LineString).coordinates;

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
        const nearest = this.findNearestNodeDuringBuild([lat, lon]);
        if (nearest) nearest.trafficSignal = true;
      }
    });
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

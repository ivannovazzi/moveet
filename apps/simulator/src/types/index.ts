// ─── Re-exports from shared types ───────────────────────────────────
// These re-exports ensure all existing imports continue to work.
export type {
  Position,
  VehicleType,
  VehicleDTO,
  ExportVehicle,
  VehicleUpdate,
  Fleet,
  TimeOfDay,
  ClockState,
  SimulationStatus,
  StartOptions,
  HighwayType,
  Node,
  Edge,
  Route,
  Waypoint,
  DirectionResult,
  POI,
  IncidentType,
  IncidentDTO,
  RecordingMetadata,
  ReplayStatus,
  VehicleStats,
  AnalyticsSummary,
  FleetAnalytics,
  AnalyticsSnapshot,
  SubscribeFilter,
} from "@moveet/shared-types";

// Re-export ExportVehicle under its old name for backwards compatibility
export type { ExportVehicle as DataVehicle } from "@moveet/shared-types";

// ─── Simulator-specific types ───────────────────────────────────────

import type {
  VehicleType,
  HighwayType,
  Edge,
  Route,
  Waypoint,
  StartOptions,
} from "@moveet/shared-types";

export type VehicleSize = "small" | "medium" | "large";

export interface VehicleProfile {
  type: VehicleType;
  minSpeed: number;
  maxSpeed: number;
  acceleration: number;
  deceleration: number;
  restrictedHighways: HighwayType[];
  ignoreHeatZones: boolean;
  size: VehicleSize;
}

export interface Vehicle {
  id: string;
  name: string;
  type: VehicleType;
  currentEdge: Edge;
  position: [number, number];
  speed: number;
  bearing: number;
  progress: number;
  edgeIndex?: number; // Cached index of current edge in route for performance
  dwellUntil?: number; // timestamp (ms) when vehicle should resume moving
  targetSpeed?: number; // desired speed, changes every few seconds
  fleetId?: string;
  waypoints?: Waypoint[]; // ordered waypoint sequence for multi-stop routing
  currentWaypointIndex?: number; // index of current target waypoint in waypoints[]
  /**
   * Arbitrary source-provided metadata from the originating ExportVehicle.
   * Carried opaquely so it survives the sync egress back to the adapter/sinks.
   */
  sourceMetadata?: Record<string, unknown>;
}

// Time-of-day types
export interface TimeRange {
  start: number;
  end: number;
  demandMultiplier: number;
  affectedHighways: string[];
}

export interface TrafficProfile {
  name: string;
  timeRanges: TimeRange[];
}

export interface PathNode {
  id: string;
  gScore: number;
  fScore: number;
}

export interface RouteLeg {
  edges: Edge[];
  distance: number;
  waypointIndex: number; // which waypoint this leg leads to
}

export interface MultiStopRoute {
  legs: RouteLeg[];
  totalDistance: number;
}

export interface WaypointRequest {
  lat: number;
  lng: number;
  dwellTime?: number; // seconds to dwell at this waypoint (default: 10-60s random)
  label?: string;
}

export interface DirectionRequest {
  id: string;
  lat: number;
  lng: number;
  waypoints?: WaypointRequest[]; // if provided, lat/lng is ignored and waypoints are used
}

export interface Direction {
  vehicleId: string;
  route: Route;
  eta?: number;
  waypoints?: Waypoint[];
  currentWaypointIndex?: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface HeatZoneProperties {
  id: string;
  intensity: number;
  timestamp: string;
  radius: number;
}

export interface HeatZone {
  polygon: number[][];
  intensity: number; // 0-1 scale
  timestamp: string;
}

export interface HeatZoneFeature {
  type: "Feature";
  properties: {
    id: string;
    intensity: number;
    timestamp: string;
    radius: number;
  };
  geometry: {
    type: "Polygon";
    coordinates: [number, number][];
  };
}

// ─── Incidents / Road Events ────────────────────────────────────────

export interface Incident {
  id: string;
  edgeIds: string[];
  type: "accident" | "closure" | "construction";
  severity: number; // 0-1
  speedFactor: number; // 0 = fully blocked, 0.1-0.3 = accident, 0.3-0.6 = construction
  startTime: number; // timestamp (ms)
  duration: number; // ms
  autoClears: boolean;
  position: [number, number]; // midpoint of first affected edge [lat, lng]
}

// ─── Recording & Replay ─────────────────────────────────────────────

export type RecordingEventType =
  | "vehicle"
  | "incident"
  | "heatzone"
  | "spawn"
  | "despawn"
  | "direction"
  | "waypoint"
  | "route:completed"
  | "vehicle:rerouted"
  | "simulation:start"
  | "simulation:stop"
  | "simulation:reset";

export interface RecordingHeader {
  format: "moveet-recording";
  version: 1;
  startTime: string; // ISO 8601
  vehicleCount: number;
  options: StartOptions;
}

export interface RecordingEvent {
  timestamp: number; // ms since recording start
  type: RecordingEventType;
  data: Record<string, unknown>;
}

export interface VehicleSnapshot {
  id: string;
  type?: VehicleType;
  position: [number, number];
  speed: number;
  heading: number;
  edgeId: string;
  fleetId?: string;
}

// ─── Headless Historical Truth (NDJSON contract, shared with Phase 2) ─

/**
 * Header line (line 1) of a `moveet-headless-truth` NDJSON file.
 * Must stay in sync with the Phase 2 (adapter) reader — DO NOT diverge.
 */
export interface TruthHeader {
  format: "moveet-headless-truth";
  version: 1;
  /** Absolute, historical ISO 8601 start of the simulated window. */
  simStart: string;
  /** Simulated milliseconds advanced per step. */
  stepMs: number;
  vehicleCount: number;
  /** Sim RNG seed for reproducibility (best-effort; see HeadlessRunner). */
  seed: number;
  /** Network identifier (e.g. "nairobi"). */
  network: string;
}

/** Per-vehicle entry inside a {@link TruthStepRecord}. */
export interface TruthVehicle {
  id: string;
  /** [lat, lon] — matches VehicleDTO.position. */
  position: [number, number];
  /** Ground speed in km/h — matches VehicleDTO.speed. */
  speed: number;
  /** Heading in degrees. */
  heading: number;
  /** Whether the vehicle is powered/running this step. */
  ignition: boolean;
}

/**
 * One step record per simulated step. `simTime` is ABSOLUTE sim time, not a
 * relative offset. Every active vehicle is present every step (no dedup).
 */
export interface TruthStepRecord {
  simTime: string;
  vehicles: TruthVehicle[];
}

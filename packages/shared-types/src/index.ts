// ─── Shared Domain Types for Moveet ─────────────────────────────────
// Types used by 2 or more apps in the monorepo.
// App-specific types remain in their own type files.

// ─── Primitives ─────────────────────────────────────────────────────

/** [latitude, longitude] coordinate pair */
export type Position = [number, number];

// ─── Vehicle Types ──────────────────────────────────────────────────

export type VehicleType = "car" | "truck" | "motorcycle" | "ambulance" | "bus";

export interface VehicleDTO {
  id: string;
  name: string;
  type: VehicleType;
  position: Position;
  speed: number;
  heading: number;
  fleetId?: string;
}

/**
 * Vehicle data exported from a data source (adapter) or consumed by the simulator.
 * Known as `DataVehicle` in the simulator and `ExportVehicle` in the adapter.
 */
export interface ExportVehicle {
  id: string;
  name: string;
  position?: Position;
  type?: VehicleType;
}

export interface VehicleUpdate {
  latitude: number;
  longitude: number;
  id: string;
  type?: VehicleType;
}

// ─── Fleet ──────────────────────────────────────────────────────────

export interface Fleet {
  id: string;
  name: string;
  color: string;
  source: "local" | "external";
  vehicleIds: string[];
}

// ─── Simulation ─────────────────────────────────────────────────────

export type TimeOfDay = "morning_rush" | "midday" | "evening_rush" | "night";

export interface ClockState {
  currentTime: string; // ISO date string
  speedMultiplier: number;
  hour: number;
  timeOfDay: TimeOfDay;
}

export interface SimulationStatus {
  interval: number;
  running: boolean;
  ready: boolean;
  clock?: ClockState;
}

export interface StartOptions {
  minSpeed: number;
  maxSpeed: number;
  speedVariation: number;
  acceleration: number;
  deceleration: number;
  turnThreshold: number;
  heatZoneSpeedFactor: number;
  updateInterval: number;
}

// ─── Road Network (shared subset) ──────────────────────────────────

export type HighwayType =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "unclassified"
  | "living_street";

export interface Node {
  id: string;
  coordinates: Position;
  connections: Edge[];
  trafficSignal?: boolean; // true when OSM highway=traffic_signals node
}

export interface Edge {
  id: string;
  streetId: string;
  name?: string;
  start: Node;
  end: Node;
  distance: number;
  bearing: number;
  highway: HighwayType;
  maxSpeed: number;
  surface: string;
  oneway: boolean;
  lanes?: number; // OSM lanes count (default 1)
  capacity?: number; // lanes × 1800 veh/hour (HCM standard)
  smoothnessFactor?: number; // 0.3–1.0 speed multiplier from OSM smoothness tag
}

export interface Route {
  edges: Edge[];
  distance: number;
}

// ─── Routing & Directions ───────────────────────────────────────────

export interface Waypoint {
  position: Position;
  dwellTime?: number;
  label?: string;
}

export interface DirectionResult {
  vehicleId: string;
  status: "ok" | "error";
  error?: string;
  route?: {
    start: Position;
    end: Position;
    distance: number;
  };
  eta?: number;
  snappedTo?: Position;
  waypointCount?: number;
  legs?: { start: Position; end: Position; distance: number }[];
}

// ─── POI ────────────────────────────────────────────────────────────

export interface POI {
  id: string;
  name: string | null;
  coordinates: Position;
  type: string;
}

// ─── Incidents ──────────────────────────────────────────────────────

export type IncidentType = "accident" | "closure" | "construction";

export interface IncidentDTO {
  id: string;
  edgeIds: string[];
  type: IncidentType;
  severity: number;
  speedFactor: number;
  startTime: number;
  duration: number;
  expiresAt: number;
  autoClears: boolean;
  position: Position;
}

// ─── Analytics ────────────────────────────────────────────────────

export interface VehicleStats {
  distanceTraveled: number; // km, sum of edge lengths traversed
  idleTime: number; // seconds spent with speed=0 or at waypoint dwell
  activeTime: number; // seconds spent moving
  avgSpeed: number; // km/h rolling average
  optimalDistance: number; // km, shortest-path distance for current route
  actualDistance: number; // km, actual distance traveled on current route
  waypointsReached: number; // count of waypoints reached
  lastUpdated: number; // timestamp
}

export interface AnalyticsSummary {
  totalVehicles: number;
  activeVehicles: number;
  totalDistanceTraveled: number; // km
  avgSpeed: number; // km/h across all vehicles
  totalIdleTime: number; // seconds
  avgRouteEfficiency: number; // ratio optimal/actual, 1.0 = perfect
  timestamp: number;
}

export interface FleetAnalytics {
  fleetId: string;
  vehicleCount: number;
  activeCount: number;
  totalDistance: number;
  avgSpeed: number;
  totalIdleTime: number;
  routeEfficiency: number;
  vehicles: VehicleStats[];
}

export interface AnalyticsSnapshot {
  summary: AnalyticsSummary;
  fleets: FleetAnalytics[];
  timestamp: number;
}

// ─── Geofencing ─────────────────────────────────────────────────────

export type GeoFenceType = "restricted" | "delivery" | "monitoring";

export interface GeoFence {
  id: string;
  name: string;
  type: GeoFenceType;
  /** Array of [longitude, latitude] coordinate pairs forming a closed polygon. */
  polygon: [number, number][];
  color?: string;
  active: boolean;
}

export interface GeoFenceEvent {
  type: "geofence:event";
  fenceId: string;
  fenceName: string;
  vehicleId: string;
  vehicleName: string;
  event: "enter" | "exit";
  timestamp: string; // ISO date string
}

// REST CRUD types
export interface CreateGeoFenceRequest {
  name: string;
  type: GeoFenceType;
  polygon: [number, number][];
  color?: string;
}

export interface UpdateGeoFenceRequest {
  name?: string;
  type?: GeoFenceType;
  polygon?: [number, number][];
  color?: string;
  active?: boolean;
}

// ─── WebSocket Subscribe Filters ─────────────────────────────────────

/** Geographic bounding box for spatial filtering. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Filter criteria for a WebSocket client's vehicle update subscription.
 * All specified criteria must match (AND logic). Omitted fields are not filtered.
 */
export interface SubscribeFilter {
  /** Only send vehicles assigned to these fleet IDs. Vehicles with no fleetId are excluded. */
  fleetIds?: string[];
  /** Only send vehicles of these types. */
  vehicleTypes?: VehicleType[];
  /** Only send vehicles whose position is within this bounding box. */
  bbox?: BoundingBox;
}

// ─── Recording & Replay ────────────────────────────────────────────

export interface RecordingMetadata {
  filePath: string;
  startTime: string;
  duration: number;
  eventCount: number;
  fileSize: number;
  vehicleCount: number;
}

export interface ReplayStatus {
  mode: "live" | "replay";
  file?: string;
  progress?: number; // 0-1
  duration?: number; // total recording duration in ms
  currentTime?: number; // current playback position in ms
  speed?: number; // playback speed multiplier
  paused?: boolean;
}

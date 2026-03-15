export interface Fleet {
  id: string;
  name: string;
  color: string;
  source: "local" | "external";
  vehicleIds: string[];
}

export interface DataVehicle {
  id: string;
  name: string;
  /** Advisory seed position [lat, lng]. Simulator uses this to find nearest graph edge for initial placement. */
  position: [number, number];
}
export type HighwayType =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential";

export interface Node {
  id: string;
  coordinates: [number, number];
  connections: Edge[];
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
}

export interface Vehicle {
  id: string;
  name: string;
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
}

export interface VehicleDTO {
  id: string;
  name: string;
  position: [number, number];
  speed: number;
  heading: number;
  fleetId?: string;
}

export interface SimulationStatus {
  interval: number;
  running: boolean;
  ready: boolean;
}

export interface PathNode {
  id: string;
  gScore: number;
  fScore: number;
}

export interface POI {
  id: string;
  name: string | null;
  coordinates: [number, number];
  type: string;
}

export interface Route {
  edges: Edge[];
  distance: number;
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

export interface Waypoint {
  position: [number, number];
  dwellTime?: number;
  label?: string;
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

export interface DirectionResult {
  vehicleId: string;
  status: "ok" | "error";
  error?: string;
  route?: {
    start: [number, number];
    end: [number, number];
    distance: number;
  };
  eta?: number;
  snappedTo?: [number, number];
  waypointCount?: number;
  legs?: { start: [number, number]; end: [number, number]; distance: number }[];
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

export type IncidentType = "accident" | "closure" | "construction";

export interface Incident {
  id: string;
  edgeIds: string[];
  type: IncidentType;
  severity: number; // 0-1
  speedFactor: number; // 0 = fully blocked, 0.1-0.3 = accident, 0.3-0.6 = construction
  startTime: number; // timestamp (ms)
  duration: number; // ms
  autoClears: boolean;
  position: [number, number]; // midpoint of first affected edge [lat, lng]
}

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
  position: [number, number];
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

export interface RecordingMetadata {
  filePath: string;
  startTime: string;
  duration: number;
  eventCount: number;
  fileSize: number;
  vehicleCount: number;
}

export interface VehicleSnapshot {
  id: string;
  position: [number, number];
  speed: number;
  heading: number;
  edgeId: string;
  fleetId?: string;
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

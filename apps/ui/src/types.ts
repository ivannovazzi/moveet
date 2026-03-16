export interface ApiResponse<T> {
  data: T | undefined;
  error?: string;
}

export type Position = [number, number];

export type LatLng = {
  lat: number;
  lng: number;
};

export interface Modifiers {
  showDirections: boolean;
  showHeatzones: boolean;
  showHeatmap: boolean;
  showVehicles: boolean;
  showPOIs: boolean;
  showTrafficOverlay: boolean;
}

export interface Fleet {
  id: string;
  name: string;
  color: string;
  source: "local" | "external";
  vehicleIds: string[];
}

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

interface VehicleUIFlags {
  visible: boolean;
  selected: boolean;
  hovered: boolean;
}

export type Vehicle = VehicleDTO & VehicleUIFlags;

export interface SimulationStatus {
  interval: number;
  running: boolean;
  ready: boolean;
  clock?: ClockState;
}

export type TimeOfDay = "morning_rush" | "midday" | "evening_rush" | "night";

export interface ClockState {
  currentTime: string; // ISO date string
  speedMultiplier: number;
  hour: number;
  timeOfDay: TimeOfDay;
}

export interface StartOptions {
  minSpeed: number;
  maxSpeed: number;
  speedVariation: number;
  acceleration: number;
  deceleration: number;
  turnThreshold: number;
  updateInterval: number;
  heatZoneSpeedFactor: number;
}

interface RoadFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: Position[];
  };
  properties: {
    name?: string;
    type?: string;
    speed_limit?: number;
    highway?: string;
    streetId?: string;
    "@id"?: string;
  };
}

export interface RoadNetwork {
  type: "FeatureCollection";
  features: RoadFeature[];
}
export interface Route {
  edges: Edge[];
  distance: number;
}

export interface Node {
  id: string;
  coordinates: Position;
  connections: Edge[];
}

export interface Edge {
  id: string;
  streetId: string;
  start: Node;
  end: Node;
  distance: number;
  bearing: number;
}

export interface Waypoint {
  position: [number, number]; // [lat, lng]
  label?: string;
  dwellTime?: number;
}

export interface VehicleDirection {
  vehicleId: string;
  route: Route;
  eta: number;
  waypoints?: Waypoint[];
  currentWaypointIndex?: number;
}

export interface Road {
  name: string;
  nodeIds: Set<string>;
  streets: Position[][];
}

export interface POI {
  id: string;
  name: string | null;
  coordinates: Position;
  type: string;
}

export interface Heatzone {
  type: "Feature";
  properties: {
    id: string;
    intensity: number;
    timestamp: string;
    radius: number;
  };
  geometry: {
    type: "Polygon";
    coordinates: Position[];
  };
}

export interface DirectionResult {
  vehicleId: string;
  status: "ok" | "error";
  error?: string;
  route?: { start: [number, number]; end: [number, number]; distance: number };
  eta?: number;
  snappedTo?: [number, number];
  waypointCount?: number;
  legs?: { start: [number, number]; end: [number, number]; distance: number }[];
}

export interface DirectionResponse {
  status: string;
  results: DirectionResult[];
}

export interface DispatchAssignment {
  vehicleId: string;
  vehicleName: string;
  waypoints: Waypoint[];
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
  position: [number, number];
}

// ─── Traffic ────────────────────────────────────────────────────────

export interface TrafficEdge {
  edgeId: string;
  congestion: number; // 0.2 (jammed) to 1.0 (free flow)
  coordinates: [number, number][];
  highway: string;
  streetId: string;
}

// ─── Recording & Replay ────────────────────────────────────────────

export interface RecordingFile {
  fileName: string;
  fileSize: number;
  modifiedAt: string;
}

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
  progress?: number;
  duration?: number;
  currentTime?: number;
  speed?: number;
  paused?: boolean;
}

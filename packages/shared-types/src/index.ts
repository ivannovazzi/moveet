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
  position: Position;
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
  | "residential";

export interface Node {
  id: string;
  coordinates: Position;
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

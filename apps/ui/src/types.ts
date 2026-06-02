// ─── Re-exports from shared types ───────────────────────────────────
// These re-exports ensure all existing imports continue to work.
export type {
  Position,
  VehicleType,
  VehicleDTO,
  Fleet,
  TimeOfDay,
  ClockState,
  SimulationStatus,
  StartOptions,
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
} from "@moveet/shared-types";

// ─── UI-specific types ──────────────────────────────────────────────

import type { Position, VehicleDTO, Route, Waypoint } from "@moveet/shared-types";

export interface ApiResponse<T> {
  data: T | undefined;
  error?: string;
}

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
  showBreadcrumbs: boolean;
  showSpeedLimits: boolean;
}

interface VehicleUIFlags {
  visible: boolean;
  selected: boolean;
  hovered: boolean;
}

export type Vehicle = VehicleDTO & VehicleUIFlags;

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

export interface DirectionResponse {
  status: string;
  results: import("@moveet/shared-types").DirectionResult[];
}

export interface DispatchAssignment {
  vehicleId: string;
  vehicleName: string;
  waypoints: Waypoint[];
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
  /** Numeric id assigned by the simulator stateStore (present for generated/persisted recordings). */
  id?: number;
  fileName: string;
  fileSize: number;
  modifiedAt: string;
  /** Number of vehicles captured (populated for generated recordings). */
  vehicleCount?: number;
  /** True when produced by the headless historical generator. */
  generated?: boolean;
}

// ─── Historical Generation ─────────────────────────────────────────

export interface GenerateRecordingRequest {
  /** Historical start time as an ISO 8601 string. */
  startTime: string;
  hours: number;
  vehicleCount: number;
  /** Sim-ms advanced per step. */
  stepMs: number;
  seed?: number;
}

export interface GenerateAcceptedResponse {
  status: "generating";
  jobId: string;
}

export interface GenerateStatus {
  state: "idle" | "running" | "done" | "error";
  jobId?: string;
  step?: number;
  totalSteps?: number;
  pct?: number;
}

// ─── Scenarios ────────────────────────────────────────────────────

export interface ScenarioFile {
  fileName: string;
  fileSize: number;
  modifiedAt: string;
}

export interface ScenarioLoadResponse {
  status: string;
  scenario: { name: string; duration: number; eventCount: number };
}

export interface ScenarioStatus {
  state: "idle" | "running" | "paused";
  scenario: { name: string; duration: number; eventCount: number } | null;
  elapsed: number;
  eventIndex: number;
  eventsExecuted: number;
  upcomingEvents: Array<{ at: number; type: string }>;
}

export interface ScenarioEventPayload {
  type?: string;
  index?: number;
  at?: number;
  action?: { type: string };
  name?: string;
  eventCount?: number;
  elapsed?: number;
  eventsExecuted?: number;
}

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
  fileName: string;
  fileSize: number;
  modifiedAt: string;
}

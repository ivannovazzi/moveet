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
  // Moved from this file into shared-types (single cross-service source of truth).
  Heatzone,
  VehicleDirection,
  TrafficEdge,
  RecordingFile,
  ScenarioEventPayload,
  // Shared REST response/request DTOs.
  DirectionResponse,
  GenerateRecordingRequest,
  GenerateAcceptedResponse,
  GenerateStatus,
  ScenarioFile,
  ScenarioLoadResponse,
  ScenarioStatus,
} from "@moveet/shared-types";

// `RoadNetwork` is the UI's name for the shared `RoadNetworkResponse` shape.
export type { RoadNetworkResponse as RoadNetwork } from "@moveet/shared-types";

// ─── UI-specific types ──────────────────────────────────────────────

import type { Position, VehicleDTO, Waypoint } from "@moveet/shared-types";

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

export interface Road {
  name: string;
  nodeIds: Set<string>;
  streets: Position[][];
}

export interface DispatchAssignment {
  vehicleId: string;
  vehicleName: string;
  waypoints: Waypoint[];
}

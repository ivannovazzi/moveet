// ─── REST Response Contract for Moveet ──────────────────────────────
// Shared response/request DTO shapes for the simulator's REST endpoints.
// The UI's client.ts imports these so a changed payload shape fails to
// compile on the consumer side rather than drifting silently.

import type { DirectionResult, Position } from "./index";

// ─── Road network (/network, /roads) ────────────────────────────────

export interface RoadFeature {
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

export interface RoadNetworkResponse {
  type: "FeatureCollection";
  features: RoadFeature[];
}

// ─── Directions (/direction batch response) ─────────────────────────

export interface DirectionResponse {
  status: string;
  results: DirectionResult[];
}

// ─── Historical generation (/recording/generate*) ───────────────────

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

// ─── Scenarios (/scenarios*) ────────────────────────────────────────

export interface ScenarioSummary {
  name: string;
  duration: number;
  eventCount: number;
}

export interface ScenarioFile {
  fileName: string;
  fileSize: number;
  modifiedAt: string;
}

export interface ScenarioLoadResponse {
  status: string;
  scenario: ScenarioSummary;
}

export interface ScenarioStatus {
  state: "idle" | "running" | "paused";
  scenario: ScenarioSummary | null;
  elapsed: number;
  eventIndex: number;
  eventsExecuted: number;
  upcomingEvents: Array<{ at: number; type: string }>;
}

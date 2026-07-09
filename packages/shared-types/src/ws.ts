// ─── WebSocket Contract for Moveet ──────────────────────────────────
// Single source of truth for the simulator -> UI WebSocket message
// contract. The simulator's WebSocketBroadcaster is typed against
// WsMessageMap; the UI parses against the derived WebSocketMessage union.

import type {
  VehicleDTO,
  VehicleType,
  Position,
  SimulationStatus,
  StartOptions,
  Fleet,
  IncidentDTO,
  ReplayStatus,
  ClockState,
  AnalyticsSnapshot,
  GeoFenceEvent,
  Route,
  Waypoint,
  SubscribeFilter,
  BoundingBox,
} from "./index";

// ─── UI/producer-shared payload shapes ──────────────────────────────
// These moved out of the UI so both producer (simulator) and consumer
// (UI) reference one definition.

/**
 * Heat zone GeoJSON-style feature broadcast on the `heatzones` channel.
 * Matches the simulator's `HeatZoneFeature` shape exactly.
 */
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

/**
 * A vehicle's active route + ETA, broadcast on the `direction` channel and
 * carried in `ResetPayload.directions`. `eta` is optional because the
 * simulator's reset-time direction snapshot may omit it.
 */
export interface VehicleDirection {
  vehicleId: string;
  route: Route;
  eta?: number;
  waypoints?: Waypoint[];
  currentWaypointIndex?: number;
}

/**
 * Per-edge congestion snapshot, broadcast on the `traffic` channel.
 * Matches `TrafficManager.getTrafficSnapshot` exactly.
 */
export interface TrafficEdge {
  edgeId: string;
  congestion: number; // 0.2 (jammed) to 1.0 (free flow)
  coordinates: [number, number][];
  highway: string;
  streetId: string;
}

/**
 * A recording row as surfaced to the UI by the `/recordings` listing.
 */
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

/**
 * The recording row carried by the `generate:complete` WS payload. Built from
 * the recording metadata (or a persisted stateStore row), so it exposes the
 * metadata/db fields rather than the `/recordings` listing fields. Matches
 * what `eventWiring` actually emits.
 */
export interface GeneratedRecording {
  id?: number;
  filePath: string;
  duration: number;
  eventCount: number;
  fileSize: number;
  vehicleCount: number;
  startTime: string;
  createdAt?: string;
}

/** Loosely-typed payload carried by every `scenario:*` channel. */
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

// ─── WS payload interfaces (moved from apps/ui/src/utils/wsTypes.ts) ─

export interface ResetPayload {
  vehicles: VehicleDTO[];
  directions: VehicleDirection[];
}

export interface WaypointReachedPayload {
  vehicleId: string;
  waypointIndex: number;
  waypointLabel?: string;
  remaining: number;
}

export interface RouteCompletedPayload {
  vehicleId: string;
}

export interface IncidentClearedPayload {
  id: string;
  reason: string;
}

export interface VehicleReroutedPayload {
  vehicleId: string;
  incidentId: string;
}

export interface GenerateProgressPayload {
  jobId: string;
  step: number;
  totalSteps: number;
  pct: number;
}

export interface GenerateCompletePayload {
  jobId: string;
  recording: GeneratedRecording;
}

export interface GenerateErrorPayload {
  jobId: string;
  error: string;
}

export interface FleetDeletedPayload {
  id: string;
}

export interface FleetAssignedPayload {
  fleetId: string | null;
  vehicleIds: string[];
}

// ─── Message map: the canonical contract ────────────────────────────
// Maps each WS message `type` to the `data` payload it carries. The
// no-data control frames (`connect`/`disconnect`) are intentionally
// absent here and modeled separately in WebSocketMessage below.

export interface WsMessageMap {
  vehicle: VehicleDTO;
  vehicles: VehicleDTO[];
  status: SimulationStatus;
  options: StartOptions;
  heatzones: Heatzone[];
  direction: VehicleDirection;
  reset: ResetPayload;
  "fleet:created": Fleet;
  "fleet:deleted": FleetDeletedPayload;
  "fleet:assigned": FleetAssignedPayload;
  "waypoint:reached": WaypointReachedPayload;
  "route:completed": RouteCompletedPayload;
  "incident:created": IncidentDTO;
  "incident:cleared": IncidentClearedPayload;
  "vehicle:rerouted": VehicleReroutedPayload;
  "replay:status": ReplayStatus;
  "generate:progress": GenerateProgressPayload;
  "generate:complete": GenerateCompletePayload;
  "generate:error": GenerateErrorPayload;
  clock: ClockState;
  traffic: TrafficEdge[];
  analytics: AnalyticsSnapshot;
  "geofence:event": GeoFenceEvent;
  "scenario:started": ScenarioEventPayload;
  "scenario:event": ScenarioEventPayload;
  "scenario:paused": ScenarioEventPayload;
  "scenario:resumed": ScenarioEventPayload;
  "scenario:completed": ScenarioEventPayload;
  "scenario:stopped": ScenarioEventPayload;
}

/** Every data-carrying WS message type. */
export type WsDataMessageType = keyof WsMessageMap;

/** Control frames that carry no `data`. */
export type WsControlMessageType = "connect" | "disconnect";

/** Every WS message type, data-carrying or control. */
export type WsMessageType = WsDataMessageType | WsControlMessageType;

/**
 * Discriminated union of every WebSocket message, derived from WsMessageMap.
 * Data-carrying variants are `{ type; data }`; control frames are `{ type }`.
 */
export type WebSocketMessage =
  | {
      [K in WsDataMessageType]: { type: K; data: WsMessageMap[K] };
    }[WsDataMessageType]
  | { type: "connect" }
  | { type: "disconnect" };

/** The set of valid data-carrying message types, for runtime validation. */
const DATA_MESSAGE_TYPES: ReadonlySet<string> = new Set<WsDataMessageType>([
  "vehicle",
  "vehicles",
  "status",
  "options",
  "heatzones",
  "direction",
  "reset",
  "fleet:created",
  "fleet:deleted",
  "fleet:assigned",
  "waypoint:reached",
  "route:completed",
  "incident:created",
  "incident:cleared",
  "vehicle:rerouted",
  "replay:status",
  "generate:progress",
  "generate:complete",
  "generate:error",
  "clock",
  "traffic",
  "analytics",
  "geofence:event",
  "scenario:started",
  "scenario:event",
  "scenario:paused",
  "scenario:resumed",
  "scenario:completed",
  "scenario:stopped",
]);

/**
 * Type guard validating a parsed WebSocket message's outer structure.
 * Control frames (`connect`/`disconnect`) need only a `type`; every other
 * known type must carry a `data` field. Unknown types are rejected.
 */
export function isValidMessage(msg: unknown): msg is WebSocketMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const message = msg as { type?: unknown; data?: unknown };

  if (typeof message.type !== "string") return false;

  if (message.type === "connect" || message.type === "disconnect") {
    return true;
  }

  if (DATA_MESSAGE_TYPES.has(message.type)) {
    return "data" in message;
  }

  return false;
}

// ─── Stricter validators for the high-risk vehicle hot path ─────────

/** True when `n` is a real, finite number (rejects NaN/Infinity/non-number). */
function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validates that a VehicleDTO carries finite numeric position/speed/heading,
 * so NaN/Infinity positions never reach the GL layer. Returns false for any
 * malformed vehicle instead of throwing.
 */
export function isValidVehicleDTO(v: unknown): v is VehicleDTO {
  if (typeof v !== "object" || v === null) return false;
  const vehicle = v as {
    position?: unknown;
    speed?: unknown;
    heading?: unknown;
  };
  if (!Array.isArray(vehicle.position) || vehicle.position.length < 2) return false;
  return (
    isFiniteNumber(vehicle.position[0]) &&
    isFiniteNumber(vehicle.position[1]) &&
    isFiniteNumber(vehicle.speed) &&
    isFiniteNumber(vehicle.heading)
  );
}

// ─── Inbound: SubscribeFilter validation ────────────────────────────

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

const VEHICLE_TYPES: ReadonlySet<string> = new Set<VehicleType>([
  "car",
  "truck",
  "motorcycle",
  "ambulance",
  "bus",
]);

function isBoundingBox(v: unknown): v is BoundingBox {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    isFiniteNumber(b.minLat) &&
    isFiniteNumber(b.maxLat) &&
    isFiniteNumber(b.minLng) &&
    isFiniteNumber(b.maxLng)
  );
}

/**
 * Validates and narrows an untrusted inbound `subscribe` filter. Returns a
 * sanitized SubscribeFilter (dropping any unknown/invalid criteria), or null
 * if the payload is not a usable filter object. Server-side guard so a
 * malformed client filter can never reach the broadcaster's filtering logic.
 */
export function parseSubscribeFilter(input: unknown): SubscribeFilter | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") return null;

  const raw = input as Record<string, unknown>;
  const filter: SubscribeFilter = {};

  if (raw.fleetIds !== undefined) {
    if (!isStringArray(raw.fleetIds)) return null;
    filter.fleetIds = raw.fleetIds;
  }

  if (raw.vehicleTypes !== undefined) {
    if (!Array.isArray(raw.vehicleTypes)) return null;
    if (!raw.vehicleTypes.every((t) => typeof t === "string" && VEHICLE_TYPES.has(t))) {
      return null;
    }
    filter.vehicleTypes = raw.vehicleTypes as VehicleType[];
  }

  if (raw.bbox !== undefined) {
    if (!isBoundingBox(raw.bbox)) return null;
    filter.bbox = raw.bbox;
  }

  return filter;
}

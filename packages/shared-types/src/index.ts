// ─── Shared Domain Types for Moveet ─────────────────────────────────
// Types used by 2 or more apps in the monorepo.
// App-specific types remain in their own type files.

// ─── Primitives ─────────────────────────────────────────────────────

/**
 * [latitude, longitude] coordinate pair.
 * Note: GeoFence.polygon uses the GeoJSON convention [longitude, latitude].
 */
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
  /**
   * Device fix timestamp (epoch ms), as reported by the simulated device.
   * Present only for a vehicle whose device has a fault profile — a skewed
   * device clock is only observable if the sample carries its own timestamp.
   */
  timestamp?: number;
  /**
   * Device faults that shaped this sample. Present only for a vehicle whose
   * device has a fault profile, so the default (fault-free) wire shape is
   * unchanged.
   */
  faults?: DeviceFaultInfo;
}

// ─── Device fault injection ─────────────────────────────────────────
// Faults are properties of the simulated DEVICE (a GPS tracker that freezes,
// skews its clock, retransmits, or runs out of battery). This is a different
// concern from the adapter's realism engine, which models the TRANSPORT
// (correlated GPS noise, connectivity dropouts, jittered cadence). The two
// compose: a device fault is injected before the telemetry ever leaves the
// simulator, so it is visible on the WebSocket feed and in the adapter push.

export type DeviceFaultKind =
  | "frozen_gps"
  | "clock_skew"
  | "duplicate"
  | "out_of_order"
  | "battery_dead"
  | "teleport";

/** Fault annotation carried by a single telemetry sample. */
export interface DeviceFaultInfo {
  /** Fault kinds that shaped this sample. Empty when the device reported clean. */
  active: DeviceFaultKind[];
  /** Remaining battery (%), when the profile models a battery. */
  battery?: number;
  /** Applied clock offset (ms): sample timestamp minus true emit time. */
  skewMs?: number;
}

/** Per-fault tuning for one simulated device. Every fault group is opt-in. */
export interface DeviceFaultProfile {
  /** The device latches its last fix and keeps reporting it while frozen. */
  frozenGps?: {
    /** Chance per report of entering a frozen window, 0-1. */
    probability: number;
    minDurationMs: number;
    maxDurationMs: number;
  };
  /** The device's clock is wrong, and optionally drifts as it runs. */
  clockSkew?: {
    offsetMs: number;
    /** Extra skew accumulated per minute of device uptime. */
    driftMsPerMinute?: number;
  };
  /** The device retransmits a sample it has already sent. */
  duplicate?: {
    probability: number;
    /** Maximum extra copies emitted alongside the original. */
    maxCopies: number;
  };
  /** The device withholds a sample so a newer one overtakes it on the wire. */
  outOfOrder?: {
    probability: number;
    /** How long the withheld sample is held before it is released. */
    holdMs: number;
  };
  /** The device runs on a battery and goes silent when it dies. */
  battery?: {
    initialPercent: number;
    drainPercentPerHour: number;
    /** Level at or below which the device stops reporting entirely. */
    dieAtPercent: number;
  };
  /** The reported position jumps somewhere it cannot be (bad fix / spoofing). */
  teleport?: {
    probability: number;
    radiusMeters: number;
    /** How long the bogus offset persists. 0 = a single-sample glitch. */
    holdMs: number;
  };
}

/** The fault layer's whole configuration, as read and written over REST/WS. */
export interface DeviceFaultConfig {
  enabled: boolean;
  /**
   * Seed for the per-device RNG streams. Omitted = unseeded (`Math.random`);
   * every fault type is reproducible only when a seed is set.
   */
  seed?: number;
  /** Applied to every vehicle without an explicit profile. */
  default?: DeviceFaultProfile;
  /** Per-vehicle overrides keyed by vehicle id. Replaces the default outright. */
  vehicles: Record<string, DeviceFaultProfile>;
}

/** Live per-device fault state, for observability. */
export interface DeviceFaultStatus {
  enabled: boolean;
  /** Devices the fault layer currently holds state for. */
  devices: number;
  frozen: number;
  teleporting: number;
  dead: number;
  /** Samples withheld by the out-of-order fault, awaiting release. */
  held: number;
  /** Faulted samples queued for the next adapter push. */
  queued: number;
  /** Cumulative per-kind trigger counts since the last fault-layer reset. */
  counts: Record<DeviceFaultKind, number>;
}

/**
 * `GET /faults`: the configuration plus a live status snapshot, so an operator
 * surface can render "what is armed" and "what is happening" from one request.
 */
export interface DeviceFaultState extends DeviceFaultConfig {
  status: DeviceFaultStatus;
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
  /**
   * Arbitrary source-provided metadata, carried opaquely through the
   * source → simulator → sink round-trip. Sinks may ignore it.
   */
  metadata?: Record<string, unknown>;
}

export interface VehicleUpdate {
  latitude: number;
  longitude: number;
  id: string;
  type?: VehicleType;
  /** Ground speed in km/h, when the source provides it (e.g. the simulator). */
  speed?: number;
  /** Heading / course over ground in degrees, when the source provides it. */
  heading?: number;
  /** Reported horizontal accuracy in meters (e.g. GPS HDOP-derived). */
  accuracy?: number;
  /** Device fix timestamp (epoch ms). Distinct from server arrival time. */
  timestamp?: number;
  /** Device connectivity at fix time. */
  connected?: boolean;
  /**
   * Arbitrary source-provided metadata, carried opaquely from the source
   * through the simulator to the sinks. Sinks may ignore it.
   */
  metadata?: Record<string, unknown>;
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
  /** How often (ms) the simulation loop steps and broadcasts vehicle state. */
  updateInterval: number;
  /**
   * How often (ms) vehicle positions are pushed to the adapter and on to
   * downstream sinks. Independent of `updateInterval` so the publish/telemetry
   * rate can be tuned separately from the movement/broadcast rate.
   */
  adapterSyncInterval: number;
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
  /**
   * Array of [longitude, latitude] coordinate pairs forming a closed polygon.
   * Uses GeoJSON coordinate order, unlike Position which is [latitude, longitude].
   */
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

// ─── Jobs (trip / dispatch lifecycle) ───────────────────────────────

/**
 * A job's position in the dispatch lifecycle.
 *
 * `pending` is the queue: the job exists but no vehicle has been committed to
 * it yet (either none was free, or routing failed and it was re-queued). The
 * three middle states mirror what the vehicle is physically doing, so the map
 * and the panel can never disagree about whether a unit is inbound to the
 * pickup or already carrying the load.
 */
export type JobStatus =
  | "pending"
  | "assigned"
  | "en_route"
  | "on_scene"
  | "transporting"
  | "complete"
  | "cancelled"
  | "failed";

/** Job statuses that no longer move on their own. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "complete",
  "cancelled",
  "failed",
] as const;

/**
 * How a job picks its vehicle.
 *  - `nearest`: smallest great-circle distance to the pickup. Cheap, no pathfinding.
 *  - `best_eta`: pathfinds from the closest few candidates and takes the lowest
 *    driving ETA, so a nearby unit behind a closure loses to a farther one on
 *    open road.
 *  - `manual`: the operator named the vehicle; no candidate search runs.
 */
export type JobAssignmentStrategy = "nearest" | "best_eta" | "manual";

/** One end of a job. `position` is `[latitude, longitude]`, like `Position`. */
export interface JobStop {
  position: Position;
  label?: string;
}

export interface JobDTO {
  id: string;
  /** Short operator-facing handle, e.g. `JOB-4F2A`. Unique per simulator run. */
  reference: string;
  status: JobStatus;
  pickup: JobStop;
  dropoff: JobStop;
  strategy: JobAssignmentStrategy;
  vehicleId?: string;
  vehicleName?: string;
  /** Epoch ms. */
  createdAt: number;
  assignedAt?: number;
  /** Epoch ms the vehicle reached the pickup. */
  pickedUpAt?: number;
  completedAt?: number;
  /** Seconds of driving from the assigned vehicle's position to the pickup. */
  etaToPickupSeconds?: number;
  /** Seconds of driving for the whole job (to pickup, then to dropoff). */
  etaToDropoffSeconds?: number;
  /** Budget, in seconds from creation to completion, before the job is late. */
  slaSeconds: number;
  /** Epoch ms: `createdAt + slaSeconds * 1000`. */
  slaDeadline: number;
  slaBreached: boolean;
  /** Driving distance (km) of the assigned two-leg route. */
  routeDistanceKm?: number;
  /** Populated when `status === "failed"`. */
  error?: string;
}

/** REST body for `POST /jobs`. */
export interface CreateJobRequest {
  pickup: { lat: number; lng: number; label?: string };
  dropoff: { lat: number; lng: number; label?: string };
  strategy?: JobAssignmentStrategy;
  /** Required when `strategy` is `manual`. */
  vehicleId?: string;
  slaSeconds?: number;
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

// ─── WebSocket Contract ─────────────────────────────────────────────
// The full simulator -> UI WS message contract lives in ./ws.ts.
export * from "./ws";

// ─── REST Response Contract ─────────────────────────────────────────
// Shared simulator REST response/request DTOs live in ./rest.ts.
export * from "./rest";

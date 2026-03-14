import type {
  VehicleDTO,
  SimulationStatus,
  StartOptions,
  Heatzone,
  VehicleDirection,
  Fleet,
} from "@/types";

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

// Discriminated union for WebSocket messages
export type WebSocketMessage =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "vehicle"; data: VehicleDTO }
  | { type: "vehicles"; data: VehicleDTO[] }
  | { type: "status"; data: SimulationStatus }
  | { type: "options"; data: StartOptions }
  | { type: "heatzones"; data: Heatzone[] }
  | { type: "direction"; data: VehicleDirection }
  | { type: "reset"; data: ResetPayload }
  | { type: "fleet:created"; data: Fleet }
  | { type: "fleet:deleted"; data: { id: string } }
  | { type: "fleet:assigned"; data: { fleetId: string | null; vehicleIds: string[] } }
  | { type: "waypoint:reached"; data: WaypointReachedPayload }
  | { type: "route:completed"; data: RouteCompletedPayload };

/**
 * Type guard to validate WebSocket message structure
 */
export function isValidMessage(msg: unknown): msg is WebSocketMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const message = msg as { type?: string; data?: unknown };

  // Check if type field exists
  if (typeof message.type !== "string") return false;

  // Validate based on type
  switch (message.type) {
    case "connect":
    case "disconnect":
      return true;
    case "vehicle":
    case "vehicles":
    case "status":
    case "options":
    case "heatzones":
    case "direction":
    case "reset":
      return "data" in message;
    case "fleet:created":
    case "fleet:deleted":
    case "fleet:assigned":
    case "waypoint:reached":
    case "route:completed":
      return "data" in message;
    default:
      return false;
  }
}

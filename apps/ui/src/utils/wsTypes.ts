import type {
  VehicleDTO,
  SimulationStatus,
  StartOptions,
  Heatzone,
  VehicleDirection,
} from "@/types";

export interface ResetPayload {
  vehicles: VehicleDTO[];
  directions: VehicleDirection[];
}

// Discriminated union for WebSocket messages
export type WebSocketMessage =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "vehicle"; data: VehicleDTO }
  | { type: "status"; data: SimulationStatus }
  | { type: "options"; data: StartOptions }
  | { type: "heatzones"; data: Heatzone[] }
  | { type: "direction"; data: VehicleDirection }
  | { type: "reset"; data: ResetPayload };

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
    case "status":
    case "options":
    case "heatzones":
    case "direction":
    case "reset":
      return "data" in message;
    default:
      return false;
  }
}

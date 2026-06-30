// Thin shim: the WebSocket message contract now lives in @moveet/shared-types
// (packages/shared-types/src/ws.ts). Re-exported here so existing imports
// (`@/utils/wsTypes`) keep working unchanged.
export type {
  WebSocketMessage,
  WsMessageMap,
  WsMessageType,
  WsDataMessageType,
  WsControlMessageType,
  ResetPayload,
  WaypointReachedPayload,
  RouteCompletedPayload,
  IncidentClearedPayload,
  VehicleReroutedPayload,
  GenerateProgressPayload,
  GenerateCompletePayload,
  GenerateErrorPayload,
} from "@moveet/shared-types";

export { isValidMessage, isValidVehicleDTO } from "@moveet/shared-types";

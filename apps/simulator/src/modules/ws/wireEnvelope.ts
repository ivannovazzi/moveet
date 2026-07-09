import type { VehicleDTO } from "../../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";

/**
 * The envelope published on the Redis pub/sub channel. The simulator does the
 * cheap work (build this object once, JSON-serialize once) and publishes it;
 * the gateway parses it and runs the expensive per-client fan-out.
 *
 *  - `vehicles`: a flushed batch of deduplicated vehicle updates. The gateway
 *    feeds these through its own delta/bbox/backpressure fan-out.
 *  - `message`: a non-vehicle `{type,data}` frame, broadcast verbatim to every
 *    gateway client.
 */
export type WireEnvelope =
  | { kind: "vehicles"; vehicles: VehicleDTO[] }
  | {
      kind: "message";
      type: WsDataMessageType;
      data: WsMessageMap[WsDataMessageType];
    };

/** Serialize a vehicle batch envelope. */
export function encodeVehicles(vehicles: VehicleDTO[]): string {
  return JSON.stringify({ kind: "vehicles", vehicles } satisfies WireEnvelope);
}

/** Serialize a non-vehicle message envelope. */
export function encodeMessage<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): string {
  return JSON.stringify({ kind: "message", type, data } satisfies WireEnvelope);
}

/**
 * Parse an envelope read off the bus. Returns null for anything that is not a
 * well-formed envelope, so a stray publish can never crash the gateway.
 */
export function decodeEnvelope(raw: string): WireEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const env = parsed as Record<string, unknown>;
  if (env.kind === "vehicles" && Array.isArray(env.vehicles)) {
    return { kind: "vehicles", vehicles: env.vehicles as VehicleDTO[] };
  }
  if (env.kind === "message" && typeof env.type === "string" && "data" in env) {
    return {
      kind: "message",
      type: env.type as WsDataMessageType,
      data: env.data as WsMessageMap[WsDataMessageType],
    };
  }
  return null;
}

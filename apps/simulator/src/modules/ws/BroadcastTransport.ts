import type { VehicleDTO, SubscribeFilter } from "../../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";
import type { WebSocket } from "ws";

/**
 * The egress seam between the simulation thread and however broadcast messages
 * actually reach WebSocket clients.
 *
 * Two implementations exist:
 *  - {@link InProcessTransport} - fans out to in-process WS clients directly
 *    (the historical default; runs the per-client work on the sim thread).
 *  - {@link RedisPubSubTransport} - publishes serialized payloads to a Redis
 *    channel and does NO per-client work, so a separate gateway process can do
 *    the O(clients x vehicles) fan-out independently of the simulation.
 *
 * The {@link WebSocketBroadcaster} owns the inbound buffer + flush timer and
 * the public API the rest of the simulator already depends on; it delegates
 * the actual publish to the configured transport.
 */
export interface BroadcastTransport {
  /** Start any timers/connections the transport owns. */
  start(): void;

  /** Tear down timers/connections and clear transient state. */
  stop(): void;

  /**
   * Publish a flushed batch of (already deduplicated) vehicle updates. For the
   * in-process transport this is the hot per-client fan-out; for Redis it is a
   * single serialize-and-publish.
   */
  publishVehicleUpdates(vehicles: VehicleDTO[]): void;

  /** Publish a single non-vehicle message to every client. */
  publishMessage<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): void;

  /**
   * Send a non-vehicle message to a single client. Only meaningful for the
   * in-process transport (the gateway owns its own sockets); the Redis
   * transport ignores it because per-socket addressing does not cross the bus.
   */
  sendTo<K extends WsDataMessageType>(client: WebSocket, type: K, data: WsMessageMap[K]): void;

  /** Register a client for heartbeat tracking (in-process only; no-op for Redis). */
  trackClient(client: WebSocket): void;

  /** Set/clear a client's subscribe filter (in-process only; no-op for Redis). */
  setClientFilter(client: WebSocket, filter: SubscribeFilter | null): void;

  /** Note a vehicle position so bbox pre-filtering stays current. */
  indexVehicle(id: string, lat: number, lng: number): void;

  /** Remove a vehicle from any spatial index the transport keeps. */
  removeVehicle(id: string): void;

  /** Drop all index state (e.g. on simulation reset). */
  clearIndex(): void;

  /** Number of currently connected clients (0 for transports that don't own sockets). */
  readonly clientCount: number;

  /** Number of vehicles tracked in the transport's spatial index (0 if none). */
  readonly indexedVehicleCount: number;
}

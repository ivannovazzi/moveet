import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO, SubscribeFilter } from "../../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";
import type { BroadcastTransport } from "./BroadcastTransport";
import { ClientFanout } from "./ClientFanout";

/**
 * Default transport: fans flushed batches out to in-process WebSocket clients
 * directly, running the per-client delta/bbox/backpressure work on whatever
 * thread the broadcaster's flush fires on (today, the simulation thread).
 *
 * This is a thin adapter over {@link ClientFanout} - the same engine the
 * standalone gateway uses - so the fan-out logic lives in exactly one place.
 */
export class InProcessTransport implements BroadcastTransport {
  private readonly fanout: ClientFanout;

  constructor(wss: WebSocketServer, options: { pingIntervalMs: number; pongTimeoutMs: number }) {
    this.fanout = new ClientFanout(wss, options);
  }

  start(): void {
    this.fanout.startHeartbeat();
  }

  stop(): void {
    this.fanout.stop();
  }

  publishVehicleUpdates(vehicles: VehicleDTO[]): void {
    this.fanout.fanoutVehicles(vehicles);
  }

  publishMessage<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): void {
    this.fanout.broadcast(type, data);
  }

  sendTo<K extends WsDataMessageType>(client: WebSocket, type: K, data: WsMessageMap[K]): void {
    this.fanout.sendTo(client, type, data);
  }

  trackClient(client: WebSocket): void {
    this.fanout.trackClient(client);
  }

  setClientFilter(client: WebSocket, filter: SubscribeFilter | null): void {
    this.fanout.setClientFilter(client, filter);
  }

  indexVehicle(id: string, lat: number, lng: number): void {
    this.fanout.indexVehicle(id, lat, lng);
  }

  removeVehicle(id: string): void {
    this.fanout.removeVehicle(id);
  }

  clearIndex(): void {
    this.fanout.clearIndex();
  }

  get clientCount(): number {
    return this.fanout.clientCount;
  }

  get indexedVehicleCount(): number {
    return this.fanout.indexedVehicleCount;
  }
}

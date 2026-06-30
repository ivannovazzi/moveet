import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO, SubscribeFilter } from "../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";
import { WS_BROADCASTER } from "../constants";
import type { BroadcastTransport } from "./ws/BroadcastTransport";
import { InProcessTransport } from "./ws/InProcessTransport";

/** @deprecated Import from constants.ts instead. Re-exported for backwards compatibility. */
export const BACKPRESSURE_THRESHOLD = WS_BROADCASTER.BACKPRESSURE_THRESHOLD;

/** @deprecated Import from constants.ts instead. Re-exported for backwards compatibility. */
export const MAX_DROPPED_FLUSHES = WS_BROADCASTER.MAX_DROPPED_FLUSHES;

/** @deprecated Import from constants.ts instead. Re-exported for backwards compatibility. */
export const POSITION_DELTA_THRESHOLD = WS_BROADCASTER.POSITION_DELTA_THRESHOLD;

/** Default interval between ping frames sent to each client (ms). */
export const DEFAULT_PING_INTERVAL_MS = 30_000;

/** Time to wait for a pong response before considering a connection dead (ms). */
export const DEFAULT_PONG_TIMEOUT_MS = 10_000;

export interface BroadcasterOptions {
  /** Flush interval in milliseconds. Defaults to 100. */
  flushIntervalMs?: number;
  /** Interval between ping frames in milliseconds. Defaults to 30 000. Set to 0 to disable. */
  pingIntervalMs?: number;
  /** Time to wait for pong before closing the connection (ms). Defaults to 10 000. */
  pongTimeoutMs?: number;
  /**
   * Egress transport. Defaults to {@link InProcessTransport} (the historical
   * behavior: direct in-process WS fan-out). Inject a different transport
   * (e.g. RedisPubSubTransport) to publish onto a bus instead.
   */
  transport?: BroadcastTransport;
}

/**
 * Batches vehicle position updates and broadcasts them to connected WebSocket
 * clients on a fixed interval, reducing per-second message count from
 * O(vehicles * updateHz) to O(1/flushInterval) per client.
 *
 * The broadcaster owns the inbound de-duplicating buffer and the 10Hz flush
 * timer; the actual egress (per-client delta/bbox/backpressure fan-out, or a
 * publish onto a pub/sub bus) is delegated to a {@link BroadcastTransport}.
 * The default transport preserves the original direct in-process fan-out, so
 * the public API and behavior are unchanged unless a transport is injected.
 *
 * Non-vehicle messages (heatzones, direction, status, etc.) are still sent
 * immediately — only vehicle position updates are batched.
 */
export class WebSocketBroadcaster {
  private readonly flushIntervalMs: number;
  private readonly transport: BroadcastTransport;
  private readonly vehicleBuffer: Map<string, VehicleDTO> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer, options: BroadcasterOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? WS_BROADCASTER.DEFAULT_FLUSH_INTERVAL_MS;
    this.transport =
      options.transport ??
      new InProcessTransport(wss, {
        pingIntervalMs: options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
        pongTimeoutMs: options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS,
      });
  }

  /**
   * Starts the periodic flush timer and the transport (heartbeat/connection).
   * Must be called after construction.
   */
  start(): void {
    if (this.flushTimer) return;
    this.transport.start();
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Stops the flush timer and the transport, and clears the buffer.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.transport.stop();
    this.vehicleBuffer.clear();
  }

  /**
   * Registers a new client for heartbeat tracking. Call this when a client connects.
   */
  trackClient(client: WebSocket): void {
    this.transport.trackClient(client);
  }

  /**
   * Queues a vehicle update for the next batch flush.
   * If the same vehicle is updated multiple times between flushes,
   * only the latest state is sent.
   */
  queueVehicleUpdate(vehicle: VehicleDTO): void {
    this.vehicleBuffer.set(vehicle.id, vehicle);
    this.transport.indexVehicle(vehicle.id, vehicle.position[0], vehicle.position[1]);
  }

  /**
   * Removes a vehicle from the spatial index.
   * Call this when a vehicle is despawned to keep the index clean.
   */
  removeVehicle(vehicleId: string): void {
    this.transport.removeVehicle(vehicleId);
  }

  /**
   * Drops all buffered updates and clears the spatial index without stopping
   * the flush/heartbeat timers. Call on simulation reset, when the previous
   * vehicle set is discarded, to prevent the spatial index from accumulating
   * stale entries across resets.
   */
  clearVehicles(): void {
    this.vehicleBuffer.clear();
    this.transport.clearIndex();
  }

  /**
   * Sets or clears a subscribe filter for a specific client.
   * Passing null removes the filter (client receives all vehicle updates).
   */
  setClientFilter(client: WebSocket, filter: SubscribeFilter | null): void {
    this.transport.setClientFilter(client, filter);
  }

  /**
   * Sends a non-vehicle message immediately to all connected clients.
   * Typed against the shared WS contract: `type` and `data` must agree.
   */
  broadcast<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): void {
    this.transport.publishMessage(type, data);
  }

  /**
   * Sends a non-vehicle message immediately to a single client.
   * Typed against the shared WS contract: `type` and `data` must agree.
   */
  sendTo<K extends WsDataMessageType>(client: WebSocket, type: K, data: WsMessageMap[K]): void {
    this.transport.sendTo(client, type, data);
  }

  /**
   * Flushes all queued vehicle updates to the transport, which applies the
   * per-client backpressure / spatial / delta filtering (in-process) or
   * publishes them onto the bus (Redis).
   */
  private flush(): void {
    if (this.vehicleBuffer.size === 0) return;
    const vehicles = Array.from(this.vehicleBuffer.values());
    this.vehicleBuffer.clear();
    this.transport.publishVehicleUpdates(vehicles);
  }

  /**
   * Returns the number of currently connected clients.
   */
  get clientCount(): number {
    return this.transport.clientCount;
  }

  /**
   * Returns the number of pending vehicle updates in the buffer.
   */
  get pendingUpdates(): number {
    return this.vehicleBuffer.size;
  }

  /**
   * Returns the number of vehicles currently tracked in the spatial index.
   * Useful for observability and for asserting the index does not leak.
   */
  get indexedVehicleCount(): number {
    return this.transport.indexedVehicleCount;
  }
}

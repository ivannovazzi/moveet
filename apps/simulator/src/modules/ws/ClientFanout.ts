import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO, SubscribeFilter } from "../../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";
import { WS_BROADCASTER } from "../../constants";
import { SpatialVehicleIndex } from "../SpatialVehicleIndex";
import { recordWsDroppedFlush, recordWsBackpressureDisconnect } from "../../metrics";
import logger from "../../utils/logger";

/**
 * WebSocket readyState constants.
 * We define our own enum to avoid importing the ws module's OPEN constant
 * which varies by environment.
 */
const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * Per-client tracking state for backpressure, delta updates, and heartbeat.
 */
interface ClientState {
  /** Last sent position per vehicle id. */
  lastSent: Map<string, [number, number]>;
  /** Number of consecutive flushes this client was skipped due to backpressure. */
  droppedFlushes: number;
  /** Timestamp (ms) of the last pong received from this client. */
  lastPong: number;
  /** Timestamp (ms) of the last ping sent to this client. 0 means no ping sent yet. */
  lastPingSent: number;
  /** Optional subscribe filter. When set, only matching vehicles are sent. */
  filter?: SubscribeFilter;
}

export interface ClientFanoutOptions {
  /** Interval between ping frames in milliseconds. 0 disables the heartbeat. */
  pingIntervalMs: number;
  /** Time to wait for pong before closing the connection (ms). */
  pongTimeoutMs: number;
}

/**
 * The valuable, already-built per-client fan-out engine, extracted so the
 * in-process broadcaster AND the standalone WS gateway share one
 * implementation instead of copy-pasting it.
 *
 * Owns everything that scales O(clients x vehicles): per-client delta
 * filtering, bbox/subscribe filtering via a spatial index (queried once per
 * unique bbox per flush), per-client backpressure (64KB buffer cap, disconnect
 * after too many dropped flushes), per-client `JSON.stringify`, and the
 * ping/pong heartbeat.
 *
 * It does NOT own the flush timer or the inbound message buffer - that stays
 * with the caller (the broadcaster batches at 10Hz; the gateway pushes each
 * batch it receives off the bus). The caller hands it the already-deduplicated
 * vehicle array via {@link fanoutVehicles}.
 */
export class ClientFanout {
  private readonly wss: WebSocketServer;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly clientStates: WeakMap<WebSocket, ClientState> = new WeakMap();
  private readonly spatialIndex = new SpatialVehicleIndex();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer, options: ClientFanoutOptions) {
    this.wss = wss;
    this.pingIntervalMs = options.pingIntervalMs;
    this.pongTimeoutMs = options.pongTimeoutMs;
  }

  /** Starts the ping/pong heartbeat timer (no-op when pingIntervalMs is 0). */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    if (this.pingIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => this.heartbeat(), this.pingIntervalMs);
    }
  }

  /** Stops the heartbeat timer and clears the spatial index. */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.spatialIndex.clear();
  }

  /** Registers a client for heartbeat tracking. Call this when a client connects. */
  trackClient(client: WebSocket): void {
    const state = this.getClientState(client);
    state.lastPong = Date.now();
    client.on("pong", () => {
      const s = this.clientStates.get(client);
      if (s) {
        s.lastPong = Date.now();
      }
    });
  }

  /** Inserts/moves a vehicle in the spatial index used for bbox pre-filtering. */
  indexVehicle(id: string, lat: number, lng: number): void {
    this.spatialIndex.update(id, lat, lng);
  }

  /** Removes a vehicle from the spatial index. */
  removeVehicle(vehicleId: string): void {
    this.spatialIndex.remove(vehicleId);
  }

  /** Clears the spatial index (e.g. on simulation reset). */
  clearIndex(): void {
    this.spatialIndex.clear();
  }

  /**
   * Sets or clears a subscribe filter for a specific client.
   * Passing null removes the filter (client receives all vehicle updates).
   */
  setClientFilter(client: WebSocket, filter: SubscribeFilter | null): void {
    const state = this.getClientState(client);
    state.filter = filter ?? undefined;
  }

  /**
   * Sends a non-vehicle message immediately to all connected clients.
   * Typed against the shared WS contract: `type` and `data` must agree.
   */
  broadcast<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): void {
    if (this.wss.clients.size === 0) return;
    const message = JSON.stringify({ type, data });
    this.broadcastRaw(message);
  }

  /**
   * Sends an already-serialized `{type,data}` JSON string to all open clients.
   * Used by the gateway to forward control/non-vehicle frames it reads off the
   * bus without re-parsing them.
   */
  broadcastRaw(message: string): void {
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocketReadyState.OPEN) {
        this.safeSend(client, message);
      }
    }
  }

  /**
   * Sends a non-vehicle message immediately to a single client.
   * Typed against the shared WS contract: `type` and `data` must agree.
   */
  sendTo<K extends WsDataMessageType>(client: WebSocket, type: K, data: WsMessageMap[K]): void {
    if (client.readyState === WebSocketReadyState.OPEN) {
      this.safeSend(client, JSON.stringify({ type, data }));
    }
  }

  /**
   * Fans a batch of (already deduplicated) vehicle updates out to every open
   * client, applying backpressure, spatial-index bbox pre-filtering, delta
   * filtering, and the subscribe filter per client. This is the O(clients x
   * vehicles) hot path.
   */
  fanoutVehicles(vehicles: VehicleDTO[]): void {
    if (vehicles.length === 0) return;

    // Cache bbox query results within this fan-out so multiple clients
    // sharing the same bbox don't re-query the spatial index.
    const bboxCache = new Map<string, Set<string>>();

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocketReadyState.OPEN) continue;

      const state = this.getClientState(client);

      // Backpressure check
      if (
        (client as unknown as { bufferedAmount: number }).bufferedAmount >
        WS_BROADCASTER.BACKPRESSURE_THRESHOLD
      ) {
        state.droppedFlushes++;
        recordWsDroppedFlush();
        if (state.droppedFlushes > WS_BROADCASTER.MAX_DROPPED_FLUSHES) {
          recordWsBackpressureDisconnect();
          client.close();
        }
        continue;
      }

      // Determine candidate vehicles using spatial index for bbox filters
      let candidates: VehicleDTO[];
      if (state.filter?.bbox) {
        const bbox = state.filter.bbox;
        const cacheKey = `${bbox.minLat},${bbox.maxLat},${bbox.minLng},${bbox.maxLng}`;
        let inBboxIds = bboxCache.get(cacheKey);
        if (!inBboxIds) {
          inBboxIds = this.spatialIndex.queryBbox(bbox);
          bboxCache.set(cacheKey, inBboxIds);
        }
        candidates = vehicles.filter((v) => inBboxIds!.has(v.id));
      } else {
        candidates = vehicles;
      }

      // Delta filtering: only send vehicles whose position changed above threshold
      const changed = candidates.filter((v) => this.hasPositionChanged(v, state.lastSent));

      // Subscribe filter: only send vehicles matching this client's filter criteria
      const toSend = changed.filter((v) => this.passesFilter(v, state.filter));

      if (toSend.length === 0) continue;

      const message = JSON.stringify({ type: "vehicles", data: toSend });
      // Guard the send so one failing socket cannot abort the flush for the
      // remaining clients. On failure, skip the state update so the vehicles
      // are re-sent on the next flush once the socket recovers (or is closed).
      if (!this.safeSend(client, message)) continue;

      // Update last-sent positions and reset dropped counter
      for (const v of toSend) {
        state.lastSent.set(v.id, [v.position[0], v.position[1]]);
      }
      state.droppedFlushes = 0;
    }
  }

  /** Number of currently connected clients. */
  get clientCount(): number {
    return this.wss.clients.size;
  }

  /** Number of vehicles tracked in the spatial index. */
  get indexedVehicleCount(): number {
    return this.spatialIndex.size;
  }

  /**
   * Sends a message to a client, swallowing send errors so one failing
   * socket cannot abort iteration over the remaining clients.
   * Returns true if the send did not throw.
   */
  private safeSend(client: WebSocket, message: string): boolean {
    try {
      client.send(message);
      return true;
    } catch (error) {
      logger.warn(`WebSocket send failed: ${error}`);
      return false;
    }
  }

  /** Returns or initializes the per-client tracking state. */
  private getClientState(client: WebSocket): ClientState {
    let state = this.clientStates.get(client);
    if (!state) {
      state = {
        lastSent: new Map(),
        droppedFlushes: 0,
        lastPong: 0,
        lastPingSent: 0,
        filter: undefined,
      };
      this.clientStates.set(client, state);
    }
    return state;
  }

  /**
   * Determines whether a vehicle's position has changed enough to warrant
   * sending an update to this client.
   */
  private hasPositionChanged(
    vehicle: VehicleDTO,
    lastSent: Map<string, [number, number]>
  ): boolean {
    const prev = lastSent.get(vehicle.id);
    if (!prev) return true; // Never sent - always include
    const dlat = vehicle.position[0] - prev[0];
    const dlng = vehicle.position[1] - prev[1];
    return (
      Math.abs(dlat) >= WS_BROADCASTER.POSITION_DELTA_THRESHOLD ||
      Math.abs(dlng) >= WS_BROADCASTER.POSITION_DELTA_THRESHOLD
    );
  }

  /**
   * Returns true if the vehicle passes the client's subscribe filter.
   * A missing filter always passes.
   */
  private passesFilter(vehicle: VehicleDTO, filter: SubscribeFilter | undefined): boolean {
    if (!filter) return true;
    if (filter.fleetIds?.length) {
      if (!vehicle.fleetId || !filter.fleetIds.includes(vehicle.fleetId)) return false;
    }
    if (filter.vehicleTypes?.length) {
      if (!filter.vehicleTypes.includes(vehicle.type)) return false;
    }
    if (filter.bbox) {
      const [lat, lng] = vehicle.position;
      const { minLat, maxLat, minLng, maxLng } = filter.bbox;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false;
    }
    return true;
  }

  /**
   * Sends a ping to every connected client and terminates those that have not
   * responded with a pong since the last ping within the configured timeout.
   */
  private heartbeat(): void {
    const now = Date.now();

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocketReadyState.OPEN) continue;

      const state = this.getClientState(client);

      // If we never tracked this client via trackClient(), initialize lastPong now
      // so the client is not immediately considered unresponsive.
      if (state.lastPong === 0) {
        state.lastPong = now;
      }

      // Check if a previously sent ping went unanswered past the timeout
      if (
        state.lastPingSent > 0 &&
        state.lastPong < state.lastPingSent &&
        now - state.lastPingSent >= this.pongTimeoutMs
      ) {
        client.terminate();
        continue;
      }

      // Send a new ping and record when we sent it
      client.ping();
      state.lastPingSent = now;
    }
  }
}

import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO, SubscribeFilter } from "../types";
import { WS_BROADCASTER } from "../constants";

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
}

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

/**
 * Batches vehicle position updates and broadcasts them to all connected
 * WebSocket clients on a fixed interval, reducing per-second message count
 * from O(vehicles * updateHz) to O(1/flushInterval) per client.
 *
 * Features:
 * - Backpressure: skips clients whose bufferedAmount exceeds threshold
 * - Delta updates: only sends vehicles whose position changed above threshold
 * - Drop policy: closes connections that fall behind for too many flushes
 *
 * Non-vehicle messages (heatzones, direction, status, etc.) are still sent
 * immediately — only vehicle position updates are batched.
 */
export class WebSocketBroadcaster {
  private readonly wss: WebSocketServer;
  private readonly flushIntervalMs: number;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly vehicleBuffer: Map<string, VehicleDTO> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly clientStates: WeakMap<WebSocket, ClientState> = new WeakMap();

  constructor(wss: WebSocketServer, options: BroadcasterOptions = {}) {
    this.wss = wss;
    this.flushIntervalMs = options.flushIntervalMs ?? WS_BROADCASTER.DEFAULT_FLUSH_INTERVAL_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
  }

  /**
   * Starts the periodic flush timer and heartbeat. Must be called after construction.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    if (this.pingIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => this.heartbeat(), this.pingIntervalMs);
    }
  }

  /**
   * Stops the flush timer, heartbeat timer, and clears the buffer.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.vehicleBuffer.clear();
  }

  /**
   * Registers a new client for heartbeat tracking. Call this when a client connects.
   */
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

  /**
   * Queues a vehicle update for the next batch flush.
   * If the same vehicle is updated multiple times between flushes,
   * only the latest state is sent.
   */
  queueVehicleUpdate(vehicle: VehicleDTO): void {
    this.vehicleBuffer.set(vehicle.id, vehicle);
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
   */
  broadcast<T>(type: string, data: T): void {
    if (this.wss.clients.size === 0) return;
    const message = JSON.stringify({ type, data });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocketReadyState.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Sends a non-vehicle message immediately to a single client.
   */
  sendTo<T>(client: WebSocket, type: string, data: T): void {
    if (client.readyState === WebSocketReadyState.OPEN) {
      client.send(JSON.stringify({ type, data }));
    }
  }

  /**
   * Returns or initializes the per-client tracking state.
   */
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
    if (!prev) return true; // Never sent — always include
    const dlat = vehicle.position[0] - prev[0];
    const dlng = vehicle.position[1] - prev[1];
    return Math.abs(dlat) >= POSITION_DELTA_THRESHOLD || Math.abs(dlng) >= POSITION_DELTA_THRESHOLD;
  }

  /**
   * Sends a ping to every connected client and terminates those that have not
   * responded with a pong since the last ping within the configured timeout.
   *
   * Logic per client:
   * 1. If we previously sent a ping (`lastPingSent > 0`) and the client has not
   *    responded with a pong since that ping (`lastPong < lastPingSent`), and the
   *    elapsed time since the ping exceeds `pongTimeoutMs` — terminate.
   * 2. Otherwise, send a new ping and record the timestamp.
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
   * Flushes all queued vehicle updates to connected clients, applying
   * backpressure checks and delta filtering per client.
   */
  private flush(): void {
    if (this.vehicleBuffer.size === 0) return;

    const vehicles = Array.from(this.vehicleBuffer.values());
    this.vehicleBuffer.clear();

    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocketReadyState.OPEN) continue;

      const state = this.getClientState(client);

      // Backpressure check
      if (
        (client as unknown as { bufferedAmount: number }).bufferedAmount > BACKPRESSURE_THRESHOLD
      ) {
        state.droppedFlushes++;
        if (state.droppedFlushes > MAX_DROPPED_FLUSHES) {
          client.close();
        }
        continue;
      }

      // Delta filtering: only send vehicles whose position changed above threshold
      const changed = vehicles.filter((v) => this.hasPositionChanged(v, state.lastSent));

      // Subscribe filter: only send vehicles matching this client's filter criteria
      const toSend = changed.filter((v) => this.passesFilter(v, state.filter));

      if (toSend.length === 0) continue;

      const message = JSON.stringify({ type: "vehicles", data: toSend });
      client.send(message);

      // Update last-sent positions and reset dropped counter
      for (const v of toSend) {
        state.lastSent.set(v.id, [v.position[0], v.position[1]]);
      }
      state.droppedFlushes = 0;
    }
  }

  /**
   * Returns the number of currently connected clients.
   */
  get clientCount(): number {
    return this.wss.clients.size;
  }

  /**
   * Returns the number of pending vehicle updates in the buffer.
   */
  get pendingUpdates(): number {
    return this.vehicleBuffer.size;
  }
}

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

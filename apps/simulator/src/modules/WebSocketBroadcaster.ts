import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO } from "../types";

/** Backpressure threshold in bytes. Clients with bufferedAmount above this are skipped. */
export const BACKPRESSURE_THRESHOLD = 64 * 1024; // 64 KB

/** Number of consecutive skipped flushes before a slow client is disconnected. */
export const MAX_DROPPED_FLUSHES = 50;

/** Minimum position change (in degrees) to trigger a delta update for a vehicle. ~1.1 meters. */
export const POSITION_DELTA_THRESHOLD = 0.00001;

export interface BroadcasterOptions {
  /** Flush interval in milliseconds. Defaults to 100. */
  flushIntervalMs?: number;
}

/**
 * Per-client tracking state for backpressure and delta updates.
 */
interface ClientState {
  /** Last sent position per vehicle id. */
  lastSent: Map<string, [number, number]>;
  /** Number of consecutive flushes this client was skipped due to backpressure. */
  droppedFlushes: number;
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
  private readonly vehicleBuffer: Map<string, VehicleDTO> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly clientStates: WeakMap<WebSocket, ClientState> = new WeakMap();

  constructor(wss: WebSocketServer, options: BroadcasterOptions = {}) {
    this.wss = wss;
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
  }

  /**
   * Starts the periodic flush timer. Must be called after construction.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  /**
   * Stops the flush timer and clears the buffer.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.vehicleBuffer.clear();
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
      state = { lastSent: new Map(), droppedFlushes: 0 };
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

      if (changed.length === 0) continue;

      const message = JSON.stringify({ type: "vehicles", data: changed });
      client.send(message);

      // Update last-sent positions and reset dropped counter
      for (const v of changed) {
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

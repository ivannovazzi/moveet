import type { WebSocketServer, WebSocket } from "ws";
import type { VehicleDTO } from "../types";

export interface BroadcasterOptions {
  /** Flush interval in milliseconds. Defaults to 100. */
  flushIntervalMs?: number;
}

/**
 * Batches vehicle position updates and broadcasts them to all connected
 * WebSocket clients on a fixed interval, reducing per-second message count
 * from O(vehicles * updateHz) to O(1/flushInterval) per client.
 *
 * Non-vehicle messages (heatzones, direction, status, etc.) are still sent
 * immediately — only vehicle position updates are batched.
 */
export class WebSocketBroadcaster {
  private readonly wss: WebSocketServer;
  private readonly flushIntervalMs: number;
  private readonly vehicleBuffer: Map<string, VehicleDTO> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;

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
   * Flushes all queued vehicle updates as a single batched message
   * to every connected client.
   */
  private flush(): void {
    if (this.vehicleBuffer.size === 0) return;

    const vehicles = Array.from(this.vehicleBuffer.values());
    this.vehicleBuffer.clear();

    const message = JSON.stringify({ type: "vehicles", data: vehicles });

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocketReadyState.OPEN) {
        client.send(message);
      }
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

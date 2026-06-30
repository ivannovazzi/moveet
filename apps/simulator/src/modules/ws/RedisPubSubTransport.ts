import type { VehicleDTO, SubscribeFilter } from "../../types";
import type { WsMessageMap, WsDataMessageType } from "@moveet/shared-types";
import type { WebSocket } from "ws";
import type { BroadcastTransport } from "./BroadcastTransport";
import { encodeVehicles, encodeMessage } from "./wireEnvelope";
import logger from "../../utils/logger";

/**
 * Minimal structural type for the ioredis publisher we use. Declared locally so
 * this module never imports ioredis types at the top level (which would pull
 * the package into the bundle / startup even when the flag is off).
 */
export interface RedisPublisher {
  publish(channel: string, message: string): Promise<number> | void;
  quit(): Promise<unknown> | void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface RedisPubSubTransportOptions {
  redisUrl: string;
  channel: string;
  /**
   * Test seam: provide a publisher factory to inject a mock instead of opening
   * a real connection. In production this is omitted and ioredis is lazily
   * `import()`ed only when this transport is constructed/started.
   */
  createPublisher?: (redisUrl: string) => RedisPublisher | Promise<RedisPublisher>;
}

/**
 * Publishes serialized broadcast payloads to a Redis pub/sub channel. This is
 * the SIM-SIDE half of the scale-out path: it does only the cheap work
 * (serialize once, publish), never per-client work. A separate gateway process
 * subscribes to the channel and runs the actual fan-out.
 *
 * ioredis is imported lazily (`import("ioredis")`) the first time the transport
 * starts, so selecting the default in-process transport never loads ioredis.
 */
export class RedisPubSubTransport implements BroadcastTransport {
  private readonly redisUrl: string;
  private readonly channel: string;
  private readonly createPublisher: (redisUrl: string) => RedisPublisher | Promise<RedisPublisher>;
  private publisher: RedisPublisher | null = null;
  private connecting: Promise<void> | null = null;

  constructor(options: RedisPubSubTransportOptions) {
    this.redisUrl = options.redisUrl;
    this.channel = options.channel;
    this.createPublisher = options.createPublisher ?? RedisPubSubTransport.defaultPublisher;
  }

  /**
   * Default publisher factory: lazily imports ioredis so the dependency is only
   * loaded when the Redis transport is actually selected.
   */
  private static async defaultPublisher(redisUrl: string): Promise<RedisPublisher> {
    const { default: Redis } = await import("ioredis");
    return new Redis(redisUrl) as unknown as RedisPublisher;
  }

  start(): void {
    if (this.publisher || this.connecting) return;
    this.connecting = Promise.resolve(this.createPublisher(this.redisUrl))
      .then((pub) => {
        this.publisher = pub;
        pub.on("error", (err: unknown) => logger.warn(`Redis publisher error: ${err}`));
        logger.info(`Redis broadcast transport connected (channel: ${this.channel})`);
      })
      .catch((err) => {
        logger.error(`Failed to connect Redis broadcast transport: ${err}`);
      });
  }

  stop(): void {
    const pub = this.publisher;
    this.publisher = null;
    this.connecting = null;
    if (pub) {
      try {
        void pub.quit();
      } catch (err) {
        logger.warn(`Error closing Redis publisher: ${err}`);
      }
    }
  }

  publishVehicleUpdates(vehicles: VehicleDTO[]): void {
    if (vehicles.length === 0) return;
    this.publishRaw(encodeVehicles(vehicles));
  }

  publishMessage<K extends WsDataMessageType>(type: K, data: WsMessageMap[K]): void {
    this.publishRaw(encodeMessage(type, data));
  }

  /** No per-socket addressing across the bus; the gateway owns its sockets. */
  sendTo(): void {
    // Intentionally a no-op for the Redis transport.
  }

  /** Heartbeat lives in the gateway, not the publisher. */
  trackClient(_client: WebSocket): void {
    // No-op: the gateway tracks its own clients.
  }

  /** Subscribe filters are applied by the gateway, not the publisher. */
  setClientFilter(_client: WebSocket, _filter: SubscribeFilter | null): void {
    // No-op: the gateway owns per-client filters.
  }

  /** The publisher keeps no spatial index; the gateway maintains its own. */
  indexVehicle(): void {
    // No-op.
  }

  removeVehicle(): void {
    // No-op.
  }

  clearIndex(): void {
    // No-op.
  }

  get clientCount(): number {
    return 0;
  }

  get indexedVehicleCount(): number {
    return 0;
  }

  private publishRaw(payload: string): void {
    const pub = this.publisher;
    if (!pub) return; // not connected yet; drop (positions are re-sent next flush)
    try {
      const result = pub.publish(this.channel, payload);
      if (result && typeof (result as Promise<number>).catch === "function") {
        (result as Promise<number>).catch((err) => logger.warn(`Redis publish failed: ${err}`));
      }
    } catch (err) {
      logger.warn(`Redis publish threw: ${err}`);
    }
  }
}

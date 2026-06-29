import type { WebSocketServer } from "ws";
import type { BroadcastTransport } from "./BroadcastTransport";
import { InProcessTransport } from "./InProcessTransport";
import { RedisPubSubTransport } from "./RedisPubSubTransport";
import { config } from "../../utils/config";
import logger from "../../utils/logger";

export interface TransportHeartbeatOptions {
  pingIntervalMs: number;
  pongTimeoutMs: number;
}

/**
 * Build the broadcast transport from config.
 *
 * Default ("inprocess") returns the {@link InProcessTransport}, preserving the
 * historical direct WS fan-out and never touching ioredis. "redis" returns a
 * {@link RedisPubSubTransport} that publishes onto the configured channel
 * (ioredis is only loaded once that transport starts).
 *
 * `cfg` defaults to the resolved simulator config; it is injectable for tests.
 */
export function selectBroadcastTransport(
  wss: WebSocketServer,
  heartbeat: TransportHeartbeatOptions,
  cfg: {
    wsTransport: "inprocess" | "redis";
    redisUrl: string;
    wsPubSubChannel: string;
  } = config
): BroadcastTransport {
  if (cfg.wsTransport === "redis") {
    logger.info(
      `WS transport: redis (channel: ${cfg.wsPubSubChannel}) - publishing fan-out onto the bus`
    );
    return new RedisPubSubTransport({
      redisUrl: cfg.redisUrl,
      channel: cfg.wsPubSubChannel,
    });
  }
  return new InProcessTransport(wss, heartbeat);
}

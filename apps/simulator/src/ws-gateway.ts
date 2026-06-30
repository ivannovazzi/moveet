/**
 * Standalone WebSocket gateway.
 *
 * This is the scale-out half of the Redis transport: it subscribes to the
 * simulator's broadcast channel and runs the EXPENSIVE per-client fan-out
 * (delta/bbox/backpressure/spatial-index + heartbeat) against its OWN set of
 * WebSocket clients. Because it is a separate process, the number of connected
 * clients scales independently of the simulation thread.
 *
 * It reuses {@link ClientFanout} - the exact same engine the in-process
 * broadcaster uses - so the fan-out logic is not duplicated. The only gateway-
 * specific code is the Redis subscription loop and its own WS server lifecycle.
 *
 * Run with: `npm run start:gateway` (after `npm run build`). Requires
 * WS_TRANSPORT context only via REDIS_URL / WS_PUBSUB_CHANNEL / WS_GATEWAY_PORT.
 */
import http from "http";
import { WebSocketServer } from "ws";
import { parseSubscribeFilter } from "@moveet/shared-types";
import { ClientFanout } from "./modules/ws/ClientFanout";
import { decodeEnvelope } from "./modules/ws/wireEnvelope";
import { DEFAULT_PING_INTERVAL_MS, DEFAULT_PONG_TIMEOUT_MS } from "./modules/WebSocketBroadcaster";
import { config } from "./utils/config";
import logger from "./utils/logger";

export interface GatewayHandle {
  server: http.Server;
  wss: WebSocketServer;
  fanout: ClientFanout;
  /** Tear down the subscriber, fan-out, and WS server. */
  close: () => Promise<void>;
}

/**
 * Wire a {@link ClientFanout} to a WS server and a Redis subscription. Exposed
 * (rather than only run on import) so it can be exercised without spinning up
 * the process; the bottom-of-file bootstrap calls it for the real entrypoint.
 */
export async function startGateway(): Promise<GatewayHandle> {
  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required to run the WS gateway");
  }

  const server = http.createServer((_req, res) => {
    // Minimal health endpoint so the gateway is probeable.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", clients: fanout.clientCount }));
  });
  const wss = new WebSocketServer({ server });
  const fanout = new ClientFanout(wss, {
    pingIntervalMs: DEFAULT_PING_INTERVAL_MS,
    pongTimeoutMs: DEFAULT_PONG_TIMEOUT_MS,
  });
  fanout.startHeartbeat();

  wss.on("connection", (ws) => {
    fanout.trackClient(ws);
    logger.info(`Gateway client connected (total: ${fanout.clientCount})`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; filter?: unknown };
        if (msg.type === "subscribe") {
          if (msg.filter === null || msg.filter === undefined) {
            fanout.setClientFilter(ws, null);
          } else {
            const filter = parseSubscribeFilter(msg.filter);
            if (filter === null) {
              logger.warn({ filter: msg.filter }, "Gateway ignoring malformed subscribe filter");
            } else {
              fanout.setClientFilter(ws, filter);
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      logger.info(`Gateway client disconnected (total: ${fanout.clientCount})`);
    });
  });

  // Lazily import ioredis - same dependency contract as the publisher side.
  const { default: Redis } = await import("ioredis");
  const subscriber = new Redis(config.redisUrl);

  subscriber.on("error", (err) => logger.warn(`Gateway Redis error: ${err}`));

  subscriber.on("message", (_channel, raw) => {
    const envelope = decodeEnvelope(raw);
    if (!envelope) return;
    if (envelope.kind === "vehicles") {
      // Keep the gateway's spatial index current before fanning out so bbox
      // filters work exactly as they do in-process.
      for (const v of envelope.vehicles) {
        fanout.indexVehicle(v.id, v.position[0], v.position[1]);
      }
      fanout.fanoutVehicles(envelope.vehicles);
    } else {
      fanout.broadcast(envelope.type, envelope.data);
    }
  });

  await subscriber.subscribe(config.wsPubSubChannel);
  logger.info(`Gateway subscribed to ${config.wsPubSubChannel}`);

  await new Promise<void>((resolve) => {
    server.listen(config.wsGatewayPort, () => {
      logger.info(`WS gateway listening on port ${config.wsGatewayPort}`);
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    fanout.stop();
    try {
      await subscriber.quit();
    } catch (err) {
      logger.warn(`Error closing gateway subscriber: ${err}`);
    }
    wss.clients.forEach((c) => c.close());
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { server, wss, fanout, close };
}

// ─── Bootstrap (only when run as the main module) ───────────────────────────
// Guarded so importing this file in tests does not start a server.
const isMain = process.argv[1]?.endsWith("ws-gateway.js") ?? false;
if (isMain) {
  startGateway()
    .then((gateway) => {
      const shutdown = async (signal: string) => {
        logger.info(`${signal} received; shutting down WS gateway`);
        await gateway.close();
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
    })
    .catch((err) => {
      logger.error(`Failed to start WS gateway: ${err}`);
      process.exit(1);
    });
}

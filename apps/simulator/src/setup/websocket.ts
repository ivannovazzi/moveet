import type { Server } from "http";
import { WebSocketServer } from "ws";
import {
  WebSocketBroadcaster,
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PONG_TIMEOUT_MS,
} from "../modules/WebSocketBroadcaster";
import { selectBroadcastTransport } from "../modules/ws/selectTransport";
import { parseSubscribeFilter } from "@moveet/shared-types";
import { recordWsConnection, recordWsDisconnection } from "../metrics";
import logger from "../utils/logger";

export interface WebSocketSetupResult {
  wss: WebSocketServer;
  broadcaster: WebSocketBroadcaster;
}

/**
 * Create and configure the WebSocket server and broadcaster.
 *
 * The egress transport is chosen from config (`WS_TRANSPORT`): the default
 * "inprocess" preserves the historical direct fan-out; "redis" publishes onto
 * a pub/sub bus for the standalone gateway to fan out instead.
 */
export function setupWebSocket(server: Server): WebSocketSetupResult {
  const wss = new WebSocketServer({ server });
  const transport = selectBroadcastTransport(wss, {
    pingIntervalMs: DEFAULT_PING_INTERVAL_MS,
    pongTimeoutMs: DEFAULT_PONG_TIMEOUT_MS,
  });
  const broadcaster = new WebSocketBroadcaster(wss, { flushIntervalMs: 100, transport });
  broadcaster.start();

  wss.on("connection", (ws) => {
    broadcaster.trackClient(ws);
    recordWsConnection(broadcaster.clientCount);
    logger.info(`Client connected (total: ${broadcaster.clientCount})`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; filter?: unknown };
        if (msg.type === "subscribe") {
          // Validate the untrusted inbound filter before it reaches the
          // broadcaster. A null/absent filter clears filtering; a malformed
          // filter is rejected (logged) rather than applied blindly.
          if (msg.filter === null || msg.filter === undefined) {
            broadcaster.setClientFilter(ws, null);
            logger.debug("Client cleared subscribe filter");
          } else {
            const filter = parseSubscribeFilter(msg.filter);
            if (filter === null) {
              logger.warn({ filter: msg.filter }, "Ignoring malformed subscribe filter");
            } else {
              broadcaster.setClientFilter(ws, filter);
              logger.debug({ filter }, "Client updated subscribe filter");
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      recordWsDisconnection(broadcaster.clientCount);
      logger.info(`Client disconnected (total: ${broadcaster.clientCount})`);
    });
  });

  return { wss, broadcaster };
}

import type { Server } from "http";
import { WebSocketServer } from "ws";
import { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";
import type { SubscribeFilter } from "@moveet/shared-types";
import logger from "../utils/logger";

export interface WebSocketSetupResult {
  wss: WebSocketServer;
  broadcaster: WebSocketBroadcaster;
}

/**
 * Create and configure the WebSocket server and broadcaster.
 */
export function setupWebSocket(server: Server): WebSocketSetupResult {
  const wss = new WebSocketServer({ server });
  const broadcaster = new WebSocketBroadcaster(wss, { flushIntervalMs: 100 });
  broadcaster.start();

  wss.on("connection", (ws) => {
    broadcaster.trackClient(ws);
    logger.info(`Client connected (total: ${broadcaster.clientCount})`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; filter?: unknown };
        if (msg.type === "subscribe") {
          broadcaster.setClientFilter(ws, (msg.filter as SubscribeFilter | null) ?? null);
          logger.debug({ filter: msg.filter }, "Client updated subscribe filter");
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      logger.info(`Client disconnected (total: ${broadcaster.clientCount})`);
    });
  });

  return { wss, broadcaster };
}

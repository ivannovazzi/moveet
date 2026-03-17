import type { Server } from "http";
import { WebSocketServer } from "ws";
import { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";
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

    ws.on("close", () => {
      logger.info(`Client disconnected (total: ${broadcaster.clientCount})`);
    });
  });

  return { wss, broadcaster };
}

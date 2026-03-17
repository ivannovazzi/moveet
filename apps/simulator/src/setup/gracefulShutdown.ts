import type { Server } from "http";
import type { WebSocketServer } from "ws";
import type { RoadNetwork } from "../modules/RoadNetwork";
import type { SimulationController } from "../modules/SimulationController";
import type { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";
import { generalRateLimiter, expensiveRateLimiter } from "../middleware/rateLimiter";
import logger from "../utils/logger";

export interface GracefulShutdownContext {
  server: Server;
  wss: WebSocketServer;
  broadcaster: WebSocketBroadcaster;
  simulationController: SimulationController;
  network: RoadNetwork;
  trafficBroadcastInterval: NodeJS.Timeout;
}

/**
 * Register process signal handlers for graceful shutdown.
 */
export function registerGracefulShutdown(ctx: GracefulShutdownContext): void {
  const { server, wss, broadcaster, simulationController, network, trafficBroadcastInterval } = ctx;

  function gracefulShutdown(signal: string): void {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    broadcaster.stop();
    clearInterval(trafficBroadcastInterval);
    logger.info("WebSocket broadcaster stopped");

    server.close(() => {
      logger.info("HTTP server closed");
    });

    wss.clients.forEach((client) => {
      client.close();
    });
    wss.close(() => {
      logger.info("WebSocket server closed");
    });

    simulationController.stop();
    logger.info("Simulation stopped");

    network.shutdownWorkers();
    logger.info("Pathfinding workers stopped");

    generalRateLimiter.cleanup();
    expensiveRateLimiter.cleanup();
    logger.info("Rate limiters cleaned up");

    setTimeout(() => {
      logger.info("Shutdown complete");
      process.exit(0);
    }, 1000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    gracefulShutdown("unhandledRejection");
  });
}

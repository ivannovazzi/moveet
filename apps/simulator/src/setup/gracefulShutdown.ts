import type { Server } from "http";
import type { WebSocketServer } from "ws";
import type { RoadNetwork } from "../modules/RoadNetwork";
import type { SimulationController } from "../modules/SimulationController";
import type { VehicleManager } from "../modules/VehicleManager";
import type { WebSocketBroadcaster } from "../modules/WebSocketBroadcaster";
import type { PersistenceManager } from "../modules/PersistenceManager";
import type { RecordingManager } from "../modules/RecordingManager";
import { generalRateLimiter, expensiveRateLimiter } from "../middleware/rateLimiter";
import logger from "../utils/logger";

/** Maximum time to wait for in-flight work (adapter sync, pathfinding) to settle. */
const DRAIN_TIMEOUT_MS = 5_000;

export interface GracefulShutdownContext {
  server: Server;
  wss: WebSocketServer;
  broadcaster: WebSocketBroadcaster;
  simulationController: SimulationController;
  vehicleManager?: VehicleManager;
  network: RoadNetwork;
  trafficBroadcastInterval: NodeJS.Timeout;
  analyticsBroadcastInterval: NodeJS.Timeout;
  /** Interval that flushes accumulated per-tick vehicle DTOs to the recording layer. */
  recordingBatchInterval?: NodeJS.Timeout;
  /** Flushes any pending recording batch synchronously (drain before close). */
  flushRecordingBatch?: () => void;
  recordingManager?: RecordingManager;
  persistenceManager?: PersistenceManager;
}

/**
 * Register process signal handlers for graceful shutdown.
 */
export function registerGracefulShutdown(ctx: GracefulShutdownContext): void {
  const {
    server,
    wss,
    broadcaster,
    simulationController,
    vehicleManager,
    network,
    trafficBroadcastInterval,
    analyticsBroadcastInterval,
    recordingBatchInterval,
    flushRecordingBatch,
    recordingManager,
    persistenceManager,
  } = ctx;

  // Re-entrancy latch: shutdown is now a multi-second async sequence, so a
  // second signal (or an unhandledRejection raised during teardown) must not
  // re-run server.close, the drains, or schedule a second exit timer.
  let shuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      logger.warn(`${signal} received while shutdown already in progress; ignoring`);
      return;
    }
    shuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`);

    broadcaster.stop();
    clearInterval(trafficBroadcastInterval);
    clearInterval(analyticsBroadcastInterval);
    logger.info("WebSocket broadcaster stopped");

    // Drain the recording pipeline before the process exits: stop the periodic
    // batch flush, hand the final accumulated tick window to the recording
    // layer, then stop any active recording so its NDJSON buffer is flushed to
    // disk (RecordingManager.stopRecording does a synchronous flush + close).
    if (recordingBatchInterval) clearInterval(recordingBatchInterval);
    flushRecordingBatch?.();
    if (recordingManager?.isRecording()) {
      try {
        recordingManager.stopRecording();
        logger.info("Active recording stopped and flushed");
      } catch (error) {
        logger.warn(`Error stopping recording during shutdown: ${error}`);
      }
    }

    // Stop accepting new connections; in-flight HTTP requests may finish
    server.close(() => {
      logger.info("HTTP server closed");
    });

    simulationController.stop();
    logger.info("Simulation stopped");

    // Bounded drain: wait for in-flight adapter syncs and pending
    // pathfinding-pool requests before tearing down workers.
    try {
      const [, drained] = await Promise.all([
        vehicleManager?.adapterSync.drain(DRAIN_TIMEOUT_MS),
        network.drainPathfinding(DRAIN_TIMEOUT_MS),
      ]);
      if (drained === false) {
        logger.warn(`Pathfinding requests still pending after ${DRAIN_TIMEOUT_MS}ms drain`);
      }
    } catch (error) {
      logger.warn(`Error while draining in-flight work: ${error}`);
    }

    wss.clients.forEach((client) => {
      client.close();
    });
    wss.close(() => {
      logger.info("WebSocket server closed");
    });

    await network.shutdownWorkers();
    logger.info("Pathfinding workers stopped");

    if (persistenceManager) {
      persistenceManager.shutdown();
      logger.info("Persistence manager shut down");
    }

    generalRateLimiter.cleanup();
    expensiveRateLimiter.cleanup();
    logger.info("Rate limiters cleaned up");

    setTimeout(() => {
      logger.info("Shutdown complete");
      process.exit(0);
    }, 1000);
  }

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    setTimeout(() => process.exit(1), 10_000).unref();
    void gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    setTimeout(() => process.exit(1), 10_000).unref();
    void gracefulShutdown("unhandledRejection");
  });
}

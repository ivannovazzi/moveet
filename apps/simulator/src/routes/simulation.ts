import { Router } from "express";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { validateBody } from "../middleware/validate";
import {
  startSchema,
  optionsSchema,
  clockSchema,
  trafficProfileSchema,
} from "../middleware/schemas";
import logger from "../utils/logger";

/**
 * Routes for simulation lifecycle: status, start, stop, reset, options, clock, traffic.
 */
export function createSimulationRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { vehicleManager, simulationController } = ctx;

  router.get("/status", (_req, res) => {
    try {
      res.json(simulationController.getStatus());
    } catch (error) {
      logger.error(`Error in /status: ${error}`);
      res.status(500).json({ error: "Failed to get status" });
    }
  });

  router.post(
    "/reset",
    asyncHandler(async (_req, res) => {
      await simulationController.reset();
      res.json({ status: "reset" });
    })
  );

  router.post(
    "/start",
    validateBody(startSchema),
    asyncHandler(async (req, res) => {
      await simulationController.start(req.body);
      res.json({ status: "started", vehicleTypes: req.body.vehicleTypes ?? null });
    })
  );

  router.post("/stop", (_req, res) => {
    try {
      simulationController.stop();
      res.json({ status: "stopped" });
    } catch (error) {
      logger.error(`Error in /stop: ${error}`);
      res.status(500).json({ error: "Failed to stop simulation" });
    }
  });

  router.get("/options", (_req, res) => {
    try {
      res.json(vehicleManager.getOptions());
    } catch (error) {
      logger.error(`Error in /options: ${error}`);
      res.status(500).json({ error: "Failed to get options" });
    }
  });

  router.post(
    "/options",
    validateBody(optionsSchema),
    asyncHandler(async (req, res) => {
      await simulationController.setOptions(req.body);
      res.json({ status: "options set" });
    })
  );

  // ─── Clock ──────────────────────────────────────────────────────────

  router.get("/clock", (_req, res) => {
    try {
      res.json(simulationController.getClock().getState());
    } catch (error) {
      logger.error(`Error in /clock: ${error}`);
      res.status(500).json({ error: "Failed to get clock state" });
    }
  });

  router.post(
    "/clock",
    validateBody(clockSchema),
    asyncHandler(async (req, res) => {
      const { speedMultiplier, setTime } = req.body as {
        speedMultiplier?: number;
        setTime?: string;
      };
      const clock = simulationController.getClock();
      if (speedMultiplier !== undefined) {
        clock.setSpeedMultiplier(speedMultiplier);
      }
      if (setTime !== undefined) {
        clock.setTime(new Date(setTime));
      }
      res.json(clock.getState());
    })
  );

  // ─── Traffic ────────────────────────────────────────────────────────

  router.get("/traffic", (_req, res) => {
    try {
      res.json(vehicleManager.getTrafficSnapshot());
    } catch (error) {
      logger.error(`Error in /traffic: ${error}`);
      res.status(500).json({ error: "Failed to get traffic data" });
    }
  });

  router.get("/traffic-profile", (_req, res) => {
    try {
      res.json(simulationController.getTrafficProfile());
    } catch (error) {
      logger.error(`Error in /traffic-profile: ${error}`);
      res.status(500).json({ error: "Failed to get traffic profile" });
    }
  });

  router.post(
    "/traffic-profile",
    validateBody(trafficProfileSchema),
    asyncHandler(async (req, res) => {
      simulationController.setTrafficProfile(req.body);
      res.json(simulationController.getTrafficProfile());
    })
  );

  return router;
}

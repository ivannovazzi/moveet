import { Router } from "express";
import path from "path";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { validateBody } from "../middleware/validate";
import { replayStartSchema, replaySeekSchema, replaySpeedSchema } from "../middleware/schemas";
import { expensiveRateLimiter } from "../middleware/rateLimiter";

/**
 * Routes for replay management: start, pause, resume, stop, seek, speed, status.
 */
export function createReplayRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { simulationController } = ctx;

  router.post(
    "/replay/start",
    expensiveRateLimiter.middleware(),
    validateBody(replayStartSchema),
    asyncHandler(async (req, res) => {
      const { file, speed } = req.body;
      const recordingsDir = path.resolve("recordings");
      const filePath = path.resolve("recordings", file);
      if (!filePath.startsWith(recordingsDir + path.sep)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }
      try {
        const header = await simulationController.startReplay(filePath, speed);
        res.json({ status: "replaying", header });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start replay";
        res.status(400).json({ error: message });
      }
    })
  );

  router.post(
    "/replay/pause",
    asyncHandler(async (_req, res) => {
      simulationController.pauseReplay();
      res.json({ status: "paused" });
    })
  );

  router.post(
    "/replay/resume",
    asyncHandler(async (_req, res) => {
      simulationController.resumeReplay();
      res.json({ status: "resumed" });
    })
  );

  router.post(
    "/replay/stop",
    asyncHandler(async (_req, res) => {
      simulationController.stopReplay();
      res.json({ status: "stopped" });
    })
  );

  router.post(
    "/replay/seek",
    validateBody(replaySeekSchema),
    asyncHandler(async (req, res) => {
      const { timestamp } = req.body;
      simulationController.seekReplay(timestamp);
      res.json({ status: "seeked", timestamp });
    })
  );

  router.post(
    "/replay/speed",
    validateBody(replaySpeedSchema),
    asyncHandler(async (req, res) => {
      const { speed } = req.body;
      simulationController.setReplaySpeed(speed ?? 1);
      res.json({ status: "speed_changed", speed });
    })
  );

  router.get("/replay/status", (_req, res) => {
    res.json(simulationController.getReplayStatus());
  });

  return router;
}

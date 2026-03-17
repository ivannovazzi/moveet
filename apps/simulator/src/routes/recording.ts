import { Router } from "express";
import fs from "fs";
import path from "path";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { expensiveRateLimiter } from "../middleware/rateLimiter";

/**
 * Routes for recording management: start, stop, list recordings.
 */
export function createRecordingRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { recordingManager, simulationController } = ctx;

  router.post(
    "/recording/start",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (_req, res) => {
      if (recordingManager.isRecording()) {
        res.status(409).json({ error: "Recording already in progress" });
        return;
      }
      const options = simulationController.getOptions();
      const vehicleCount = simulationController.getVehicles().length;
      const filePath = recordingManager.startRecording(options, vehicleCount);
      res.json({ status: "recording", filePath });
    })
  );

  router.post(
    "/recording/stop",
    asyncHandler(async (_req, res) => {
      if (!recordingManager.isRecording()) {
        res.status(409).json({ error: "No recording in progress" });
        return;
      }
      const metadata = recordingManager.stopRecording();
      res.json(metadata);
    })
  );

  router.get(
    "/recordings",
    asyncHandler(async (_req, res) => {
      const dir = "recordings";
      if (!fs.existsSync(dir)) {
        res.json([]);
        return;
      }
      const files = fs.readdirSync(dir);
      const result = files.map((fileName) => {
        const stat = fs.statSync(path.join(dir, fileName));
        return {
          fileName,
          fileSize: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      });
      res.json(result);
    })
  );

  return router;
}

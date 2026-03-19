import { Router } from "express";
import fs from "fs";
import path from "path";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { expensiveRateLimiter } from "../middleware/rateLimiter";

/**
 * Routes for recording management: start, stop, list, get, delete recordings.
 */
export function createRecordingRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { recordingManager, simulationController, stateStore } = ctx;

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
      // Prefer SQLite index when persistence is available
      if (stateStore) {
        const rows = stateStore.getRecordings();
        const result = rows.map((r) => ({
          id: r.id,
          filePath: r.file_path,
          duration: r.duration,
          eventCount: r.event_count,
          fileSize: r.file_size,
          vehicleCount: r.vehicle_count,
          startTime: r.start_time,
          createdAt: r.created_at,
        }));
        res.json(result);
        return;
      }

      // Filesystem fallback
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

  router.get(
    "/recordings/:id",
    asyncHandler(async (req, res) => {
      if (!stateStore) {
        res.status(501).json({ error: "Persistence not enabled" });
        return;
      }

      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid recording id" });
        return;
      }

      const row = stateStore.getRecording(id);
      if (!row) {
        res.status(404).json({ error: "Recording not found" });
        return;
      }

      res.json({
        id: row.id,
        filePath: row.file_path,
        duration: row.duration,
        eventCount: row.event_count,
        fileSize: row.file_size,
        vehicleCount: row.vehicle_count,
        startTime: row.start_time,
        createdAt: row.created_at,
      });
    })
  );

  router.delete(
    "/recordings/:id",
    asyncHandler(async (req, res) => {
      if (!stateStore) {
        res.status(501).json({ error: "Persistence not enabled" });
        return;
      }

      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid recording id" });
        return;
      }

      const filePath = stateStore.deleteRecording(id);
      if (!filePath) {
        res.status(404).json({ error: "Recording not found" });
        return;
      }

      // Remove the recording file from disk
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // File may already be gone — metadata is still cleaned up
      }

      res.json({ deleted: true, id, filePath });
    })
  );

  return router;
}

import { Router } from "express";
import fs from "fs";
import path from "path";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { expensiveRateLimiter } from "../middleware/rateLimiter";

/** Default sim ms advanced per step when a request omits `stepMs`. */
const DEFAULT_STEP_MS = 1000;

/**
 * Routes for recording management: start, stop, list, get, delete, generate,
 * download recordings.
 */
export function createRecordingRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { recordingManager, simulationController, generationManager, stateStore } = ctx;

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

  // ─── Headless historical generation ─────────────────────────────────

  router.post(
    "/recording/generate",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (req, res) => {
      if (generationManager.isRunning()) {
        res.status(409).json({ error: "A generation job is already running" });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      const startTime = new Date(String(body.startTime));
      if (Number.isNaN(startTime.getTime())) {
        res.status(400).json({ error: "startTime must be a valid ISO date" });
        return;
      }

      const vehicleCount = Number(body.vehicleCount);
      if (!Number.isInteger(vehicleCount) || vehicleCount <= 0) {
        res.status(400).json({ error: "vehicleCount must be a positive integer" });
        return;
      }

      const stepMs = body.stepMs !== undefined ? Number(body.stepMs) : DEFAULT_STEP_MS;
      if (!Number.isFinite(stepMs) || stepMs <= 0) {
        res.status(400).json({ error: "stepMs must be a positive number" });
        return;
      }

      const hours = body.hours !== undefined ? Number(body.hours) : undefined;
      const steps = body.steps !== undefined ? Number(body.steps) : undefined;
      if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0)) {
        res.status(400).json({ error: "hours must be a positive number" });
        return;
      }
      if (steps !== undefined && (!Number.isInteger(steps) || steps <= 0)) {
        res.status(400).json({ error: "steps must be a positive integer" });
        return;
      }
      if (hours === undefined && steps === undefined) {
        res.status(400).json({ error: "Provide either hours or steps" });
        return;
      }

      const seed = body.seed !== undefined ? Number(body.seed) : undefined;
      if (seed !== undefined && !Number.isFinite(seed)) {
        res.status(400).json({ error: "seed must be a number" });
        return;
      }

      const jobId = generationManager.start({
        startTime,
        hours,
        steps,
        vehicleCount,
        stepMs,
        seed,
      });

      if (!jobId) {
        // Lost a race against another start — treat as conflict.
        res.status(409).json({ error: "A generation job is already running" });
        return;
      }

      res.status(202).json({ status: "generating", jobId });
    })
  );

  router.get(
    "/recording/generate/status",
    asyncHandler(async (_req, res) => {
      res.json(generationManager.getStatus());
    })
  );

  router.get(
    "/recordings/:id/download",
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

      // Guard against path traversal: the stored file_path must resolve within
      // the recordings/ directory (mirrors the replay route's check).
      const recordingsDir = path.resolve("recordings");
      const filePath = path.resolve(row.file_path);
      if (filePath !== recordingsDir && !filePath.startsWith(recordingsDir + path.sep)) {
        res.status(400).json({ error: "Invalid file path" });
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "Recording file not found" });
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);

      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read recording" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    })
  );

  return router;
}

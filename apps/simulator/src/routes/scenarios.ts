import { Router } from "express";
import fs from "fs";
import path from "path";
import type { RouteContext } from "./types";
import { asyncHandler } from "./helpers";
import { expensiveRateLimiter } from "../middleware/rateLimiter";
import { validateBody } from "../middleware/validate";
import { scenarioSchema } from "../modules/scenario";

const SCENARIOS_DIR = path.join(__dirname, "../../data/scenarios");

/**
 * Routes for scenario management: list, load, start, pause, stop, status.
 */
export function createScenarioRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { scenarioManager } = ctx;

  // ─── List available scenario files ────────────────────────────────
  router.get(
    "/scenarios",
    asyncHandler(async (_req, res) => {
      if (!fs.existsSync(SCENARIOS_DIR)) {
        res.json([]);
        return;
      }
      const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
      const result = files.map((fileName) => {
        const stat = fs.statSync(path.join(SCENARIOS_DIR, fileName));
        return {
          fileName,
          fileSize: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      });
      res.json(result);
    })
  );

  // ─── Load a scenario from JSON body ───────────────────────────────
  router.post(
    "/scenarios/load",
    expensiveRateLimiter.middleware(),
    validateBody(scenarioSchema),
    asyncHandler(async (req, res) => {
      const scenario = scenarioManager.loadScenarioFromJSON(req.body);
      res.json({
        status: "loaded",
        scenario: {
          name: scenario.name,
          duration: scenario.duration,
          eventCount: scenario.events.length,
        },
      });
    })
  );

  // ─── Load a scenario by filename from data/scenarios/ ─────────────
  router.post(
    "/scenarios/load/:fileName",
    expensiveRateLimiter.middleware(),
    asyncHandler(async (req, res) => {
      const fileName = req.params.fileName as string;
      const filePath = path.join(SCENARIOS_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: `Scenario file not found: ${fileName}` });
        return;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const scenario = scenarioManager.loadScenarioFromJSON(parsed);
      res.json({
        status: "loaded",
        scenario: {
          name: scenario.name,
          duration: scenario.duration,
          eventCount: scenario.events.length,
        },
      });
    })
  );

  // ─── Start loaded scenario ────────────────────────────────────────
  router.post(
    "/scenarios/start",
    asyncHandler(async (_req, res) => {
      try {
        scenarioManager.start();
        res.json(scenarioManager.getStatus());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start scenario";
        res.status(409).json({ error: message });
      }
    })
  );

  // ─── Pause running scenario ───────────────────────────────────────
  router.post(
    "/scenarios/pause",
    asyncHandler(async (_req, res) => {
      try {
        scenarioManager.pause();
        res.json(scenarioManager.getStatus());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to pause scenario";
        res.status(409).json({ error: message });
      }
    })
  );

  // ─── Stop running scenario ────────────────────────────────────────
  router.post(
    "/scenarios/stop",
    asyncHandler(async (_req, res) => {
      try {
        scenarioManager.stop();
        res.json(scenarioManager.getStatus());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to stop scenario";
        res.status(409).json({ error: message });
      }
    })
  );

  // ─── Get current scenario status ──────────────────────────────────
  router.get(
    "/scenarios/status",
    asyncHandler(async (_req, res) => {
      res.json(scenarioManager.getStatus());
    })
  );

  return router;
}

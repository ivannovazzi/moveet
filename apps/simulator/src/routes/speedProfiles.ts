import express, { Router, type RequestHandler } from "express";
import type { SpeedProfileManager } from "../modules/speedprofiles/SpeedProfileManager";
import type { SpeedProfileFile } from "../modules/speedprofiles/SpeedProfileStore";
import type { PositionFix } from "../modules/speedprofiles/FixMatcher";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  speedProfileFileSchema,
  speedProfileImportQuerySchema,
  speedProfileObservationsSchema,
} from "../middleware/schemas";

/** Path of the import endpoint, which gets a larger JSON body limit (see index.ts). */
export const SPEED_PROFILE_IMPORT_PATH = "/speed-profiles/import";
/** Body limit for {@link SPEED_PROFILE_IMPORT_PATH}: a city-wide profile file is tens of MB. */
export const SPEED_PROFILE_IMPORT_LIMIT = "64mb";

/**
 * The app-wide JSON body parser. Only when speed profiles are enabled (the
 * import route exists) does {@link SPEED_PROFILE_IMPORT_PATH} get the large
 * {@link SPEED_PROFILE_IMPORT_LIMIT}; otherwise every path, including that one,
 * keeps express's default limit, so a disabled feature cannot be used to push
 * 64 MB bodies through the parser.
 */
export function jsonBodyParser(speedProfilesEnabled: boolean): RequestHandler {
  const jsonBody = express.json();
  if (!speedProfilesEnabled) return jsonBody;
  const largeJsonBody = express.json({ limit: SPEED_PROFILE_IMPORT_LIMIT });
  return (req, res, next) =>
    (req.path === SPEED_PROFILE_IMPORT_PATH ? largeJsonBody : jsonBody)(req, res, next);
}

/**
 * Learned per-edge speed profiles (registered only when SPEED_PROFILES_ENABLED):
 * stats, export/import of the portable JSON profile file (so profiles learned
 * in one run can seed another), and the ingest point for real position fixes
 * (the `adapter` source).
 */
export function createSpeedProfileRoutes(speedProfiles: SpeedProfileManager): Router {
  const router = Router();

  router.get("/speed-profiles", (_req, res) => {
    res.json(speedProfiles.stats());
  });

  router.get("/speed-profiles/export", (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="speed-profiles.json"');
    res.json(speedProfiles.exportFile());
  });

  // Literal path (=== SPEED_PROFILE_IMPORT_PATH) so the OpenAPI coverage test sees it.
  router.post(
    "/speed-profiles/import",
    validateQuery(speedProfileImportQuerySchema),
    validateBody(speedProfileFileSchema),
    (req, res) => {
      const mode = req.query.mode === "replace" ? "replace" : "merge";
      try {
        const result = speedProfiles.importFile(req.body as SpeedProfileFile, mode);
        res.json({ mode, ...result });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  );

  router.post(
    "/speed-profiles/observations",
    validateBody(speedProfileObservationsSchema),
    (req, res) => {
      const result = speedProfiles.ingestFixes((req.body as { fixes: PositionFix[] }).fixes);
      if (!result) {
        res.status(409).json({
          error: "The adapter speed profile source is not enabled (SPEED_PROFILE_SOURCES)",
        });
        return;
      }
      res.json(result);
    }
  );

  return router;
}

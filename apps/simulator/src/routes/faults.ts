import { Router } from "express";
import type { RouteContext } from "./types";
import { validateBody } from "../middleware/validate";
import { faultConfigSchema, faultProfileSchema } from "../modules/faults";

/**
 * Routes for device-level fault injection: read and edit the fault layer's
 * configuration at runtime, inspect live per-device state, and clear that state
 * without touching the configuration.
 *
 * The bodies go through the SAME zod schemas that validate `FAULT_PROFILES` at
 * startup, so there is one validation story rather than two.
 */
export function createFaultRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { faults } = ctx.vehicleManager;

  router.get("/faults", (_req, res) => {
    res.json({ ...faults.getConfig(), status: faults.getStatus() });
  });

  router.post("/faults", validateBody(faultConfigSchema), (req, res) => {
    res.json(faults.configure(req.body));
  });

  router.get("/faults/status", (_req, res) => {
    res.json(faults.getStatus());
  });

  /**
   * Clears every device's latched state (drained batteries, open frozen
   * windows, withheld samples, queued telemetry) and the trigger counters,
   * keeping the configuration. This is how a repeatable run is started over
   * from a known device state.
   */
  router.post("/faults/reset", (_req, res) => {
    faults.reset();
    res.json(faults.getStatus());
  });

  router.put("/faults/vehicles/:id", validateBody(faultProfileSchema), (req, res) => {
    res.json(faults.setVehicleProfile(req.params.id as string, req.body));
  });

  router.delete("/faults/vehicles/:id", (req, res) => {
    const vehicleId = req.params.id as string;
    if (!faults.clearVehicleProfile(vehicleId)) {
      res.status(404).json({ error: `No fault profile for vehicle "${vehicleId}"` });
      return;
    }
    res.json(faults.getConfig());
  });

  return router;
}

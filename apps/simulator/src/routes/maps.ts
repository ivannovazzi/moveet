import { Router, type Response } from "express";
import type { MapListResponse } from "@moveet/shared-types";
import { asyncHandler } from "./helpers";
import { validateParams } from "../middleware/validate";
import { mapIdParamsSchema } from "../middleware/schemas";
import {
  type MapSwitcher,
  MapActivationError,
  MapConflictError,
  MapNotFoundError,
} from "../modules/maps/MapSwitcher";
import type { MapLibrary } from "../modules/maps/MapLibrary";

export interface MapRoutesOptions {
  library: MapLibrary;
  switcher: MapSwitcher;
}

/** Maps the switcher's domain errors to HTTP statuses; anything else is rethrown. */
function sendMapError(err: unknown, res: Response): void {
  if (err instanceof MapNotFoundError) {
    res.status(404).json({ error: err.message });
  } else if (err instanceof MapConflictError) {
    res.status(409).json({ error: err.message });
  } else if (err instanceof MapActivationError) {
    res.status(422).json({ error: err.message });
  } else {
    throw err;
  }
}

/**
 * The map library: list the road networks on disk, see which one is active,
 * hot-swap to another, delete one. `/network`, `/roads`, `/pois` and
 * `/buildings*` always serve the active map.
 */
export function createMapRoutes({ library, switcher }: MapRoutesOptions): Router {
  const router = Router();

  router.get("/maps", (_req, res) => {
    const body: MapListResponse = {
      maps: library.list(),
      activeId: switcher.getActiveId(),
      switching: switcher.isSwitching,
    };
    res.json(body);
  });

  router.get("/maps/active", (_req, res) => {
    res.json(switcher.getActive());
  });

  router.post(
    "/maps/:id/activate",
    validateParams(mapIdParamsSchema),
    asyncHandler(async (req, res) => {
      try {
        res.json(await switcher.activate(req.params.id as string));
      } catch (err) {
        sendMapError(err, res);
      }
    })
  );

  router.delete("/maps/:id", validateParams(mapIdParamsSchema), (req, res) => {
    try {
      switcher.remove(req.params.id as string);
      res.status(204).end();
    } catch (err) {
      sendMapError(err, res);
    }
  });

  return router;
}

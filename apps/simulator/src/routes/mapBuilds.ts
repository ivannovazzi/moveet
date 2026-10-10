import { Router, type Response } from "express";
import type {
  GeocodeResponse,
  GeofabrikLookupResponse,
  GeofabrikOutlinesResponse,
  MapBuildAccepted,
  MapJobListResponse,
  MapPreset,
} from "@moveet/shared-types";
import { asyncHandler } from "./helpers";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  bboxQuerySchema,
  geocodeQuerySchema,
  mapBuildBodySchema,
  mapJobIdParamsSchema,
} from "../middleware/schemas";
import {
  type MapBuildBody,
  MapBuildError,
  type MapBuildManager,
  type PresetRegion,
} from "../modules/maps/MapBuildManager";
import {
  GEOFABRIK_OUTLINES_ATTRIBUTION,
  type GeofabrikIndex,
  GeofabrikUnavailableError,
} from "../modules/maps/GeofabrikIndex";
import {
  type Geocoder,
  GeocodeRateLimitError,
  GeocodeUpstreamError,
  NOMINATIM_ATTRIBUTION,
} from "../modules/maps/Geocoder";
import { type Bbox, bboxAreaKm2 } from "../modules/maps/bbox";

export interface MapBuildRoutesOptions {
  builds: MapBuildManager;
  geofabrik: Pick<GeofabrikIndex, "lookup" | "outlines">;
  geocoder: Pick<Geocoder, "search">;
  presets: Record<string, PresetRegion>;
}

/** Maps build/lookup errors to HTTP statuses; anything else is rethrown. */
function sendBuildError(err: unknown, res: Response): void {
  if (err instanceof MapBuildError) {
    res.status(err.status).json({ error: err.message });
  } else if (err instanceof GeofabrikUnavailableError) {
    res.status(503).json({ error: err.message });
  } else if (err instanceof GeocodeRateLimitError) {
    res.status(429).set("Retry-After", "1").json({ error: err.message });
  } else if (err instanceof GeocodeUpstreamError) {
    res.status(502).json({ error: err.message });
  } else {
    throw err;
  }
}

/**
 * Building new maps from OpenStreetMap data: presets, Geofabrik extract
 * lookup, place search, and the build jobs themselves. Progress is broadcast
 * on the `mapjob` WebSocket channel.
 */
export function createMapBuildRoutes({
  builds,
  geofabrik,
  geocoder,
  presets,
}: MapBuildRoutesOptions): Router {
  const router = Router();

  router.post(
    "/maps",
    // Checked before the body, so a disabled server says so whatever is sent.
    (_req, res, next) => {
      if (builds.allowed) return next();
      res
        .status(403)
        .json({ error: "Map builds are disabled on this server (ALLOW_MAP_BUILDS=false)" });
    },
    validateBody(mapBuildBodySchema),
    asyncHandler(async (req, res) => {
      try {
        const job = await builds.submit(req.body as MapBuildBody);
        const body: MapBuildAccepted = job;
        res.status(202).location(`/maps/jobs/${job.id}`).json(body);
      } catch (err) {
        sendBuildError(err, res);
      }
    })
  );

  router.get("/maps/jobs", (_req, res) => {
    const body: MapJobListResponse = { jobs: builds.list() };
    res.json(body);
  });

  router.get("/maps/jobs/:id", validateParams(mapJobIdParamsSchema), (req, res) => {
    const job = builds.get(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: `Map build job not found: ${req.params.id}` });
      return;
    }
    res.json(job);
  });

  router.delete("/maps/jobs/:id", validateParams(mapJobIdParamsSchema), (req, res) => {
    try {
      res.status(202).json(builds.cancel(req.params.id as string));
    } catch (err) {
      sendBuildError(err, res);
    }
  });

  router.get("/maps/presets", (_req, res) => {
    const list: MapPreset[] = Object.entries(presets)
      .map(([name, p]) => ({
        name,
        label: p.label,
        bbox: p.bbox,
        geofabrik: p.geofabrik,
        areaKm2: Math.round(bboxAreaKm2(p.bbox)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    res.json({ presets: list });
  });

  router.get(
    "/maps/geofabrik",
    validateQuery(bboxQuerySchema),
    asyncHandler(async (req, res) => {
      const { bbox } = bboxQuerySchema.parse(req.query) as { bbox: Bbox };
      try {
        const body: GeofabrikLookupResponse = await geofabrik.lookup(bbox);
        res.json(body);
      } catch (err) {
        sendBuildError(err, res);
      }
    })
  );

  // Simplified extract boundaries for the area picker's world map. They only
  // change with the index, so browsers may keep them for an hour.
  router.get(
    "/maps/geofabrik/regions",
    asyncHandler(async (_req, res) => {
      try {
        const body: GeofabrikOutlinesResponse = {
          regions: await geofabrik.outlines(),
          attribution: GEOFABRIK_OUTLINES_ATTRIBUTION,
        };
        res.set("Cache-Control", "public, max-age=3600").json(body);
      } catch (err) {
        sendBuildError(err, res);
      }
    })
  );

  router.get(
    "/maps/geocode",
    validateQuery(geocodeQuerySchema),
    asyncHandler(async (req, res) => {
      const { q } = geocodeQuerySchema.parse(req.query);
      try {
        const body: GeocodeResponse = {
          results: await geocoder.search(q),
          attribution: NOMINATIM_ATTRIBUTION,
        };
        res.json(body);
      } catch (err) {
        sendBuildError(err, res);
      }
    })
  );

  return router;
}

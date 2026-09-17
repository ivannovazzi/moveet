import { Router } from "express";
import type { WeatherCondition } from "@moveet/shared-types";
import type { RouteContext } from "./types";
import { validateBody } from "../middleware/validate";
import { weatherOverrideSchema } from "../middleware/schemas";

/**
 * Weather state + manual override (fleetsim-all-1ajn.5). Always mounted:
 * `WeatherManager` is always constructed (see index.ts), it just never polls
 * Open-Meteo unless `WEATHER_ENABLED=true` — so this API and the `weather` WS
 * channel work for scenarios/tests regardless of that flag.
 */
export function createWeatherRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { weatherManager } = ctx;

  router.get("/weather", (_req, res) => {
    res.json(weatherManager.state());
  });

  router.post("/weather", validateBody(weatherOverrideSchema), (req, res) => {
    const { condition, factor } = req.body as { condition?: WeatherCondition; factor?: number };
    res.json(weatherManager.setOverride({ condition, factor }));
  });

  router.delete("/weather", (_req, res) => {
    res.json(weatherManager.clearOverride());
  });

  return router;
}

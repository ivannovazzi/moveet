import { Router } from "express";
import type {
  AnalyticsHistoryEnvelope,
  AnalyticsHistoryMeta,
  AnalyticsHistoryRow,
  AnalyticsOrder,
} from "@moveet/shared-types";
import { parseBucketSpec } from "../modules/StateStore";
import type { RouteContext } from "./types";

/**
 * Headers describing what a history response left out. They are exposed to
 * browsers explicitly because the UI is a cross-origin caller and `cors()`
 * hides non-simple response headers by default.
 */
const TRUNCATION_HEADERS = [
  "X-Analytics-Matched",
  "X-Analytics-Returned",
  "X-Analytics-Omitted",
  "X-Analytics-Truncated",
  "X-Analytics-Anchor",
  "X-Analytics-Bucket",
] as const;

/** Truthy query-flag parsing (`?envelope=true|1|yes`). */
function isTruthyFlag(value: unknown): boolean {
  return value === "true" || value === "1" || value === "yes" || value === "";
}

/**
 * Routes for fleet analytics: summary, per-fleet breakdown, history, and reset.
 */
export function createAnalyticsRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { vehicleManager, stateStore } = ctx;

  /**
   * GET /analytics/summary
   * Returns aggregate analytics across all vehicles.
   */
  router.get("/analytics/summary", (_req, res) => {
    const summary = vehicleManager.analytics.getSummary();
    res.json(summary);
  });

  /**
   * GET /analytics/fleet/:id
   * Returns analytics for a specific fleet, including per-vehicle breakdown.
   */
  router.get("/analytics/fleet/:id", (req, res) => {
    const fleetId = req.params.id;
    const fleetStats = vehicleManager.analytics.getFleetStats(fleetId);
    res.json(fleetStats);
  });

  /**
   * GET /analytics/history?from=ISO&to=ISO&limit=N&order=asc|desc&bucket=auto|5m&envelope=true
   *
   * Returns the time-series analytics history from the SQLite store. Only
   * available when persistence is enabled (503 otherwise).
   *
   * When the window holds more rows than `limit`, the RECENT end is kept and
   * the older rows are dropped — the response never ends before "now" without
   * saying so. What was dropped is reported on every response through the
   * `X-Analytics-*` headers, and in the body itself when `envelope=true`.
   *
   * `bucket` downsamples server-side into fixed-width time buckets; each row
   * then carries a `bucket` object and the metadata spells out the per-field
   * aggregation used (counters keep their last value, gauges are averaged).
   *
   * The default body stays a bare `AnalyticsHistoryEntry[]`, so existing
   * `?from=&limit=` callers are unaffected.
   */
  router.get("/analytics/history", (req, res) => {
    if (!stateStore) {
      res.status(503).json({ error: "Persistence is not enabled" });
      return;
    }

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    if (limitParam !== undefined && (isNaN(limit!) || limit! < 1)) {
      res.status(400).json({ error: "limit must be a positive integer" });
      return;
    }

    const orderParam = req.query.order as string | undefined;
    if (orderParam !== undefined && orderParam !== "asc" && orderParam !== "desc") {
      res.status(400).json({ error: 'order must be "asc" or "desc"' });
      return;
    }

    const bucketParam = req.query.bucket as string | undefined;
    if (bucketParam !== undefined && parseBucketSpec(bucketParam) === null) {
      res.status(400).json({
        error:
          'bucket must be "auto", a duration such as 30s / 5m / 1h / 1d, or a millisecond count between 1000 and 604800000',
      });
      return;
    }

    const envelope = isTruthyFlag(req.query.envelope);
    const shaped = orderParam !== undefined || bucketParam !== undefined;

    // The fourth argument is omitted unless a shaping parameter was supplied,
    // keeping the historical three-argument call contract intact.
    const history = shaped
      ? stateStore.getAnalyticsHistory(from, to, limit, {
          order: orderParam as AnalyticsOrder | undefined,
          bucket: bucketParam,
        })
      : stateStore.getAnalyticsHistory(from, to, limit);

    const rows = history as AnalyticsHistoryRow[];
    const meta = (history as { meta?: AnalyticsHistoryMeta }).meta;

    if (meta) {
      res.setHeader("X-Analytics-Matched", String(meta.matched));
      res.setHeader("X-Analytics-Returned", String(meta.returned));
      res.setHeader("X-Analytics-Omitted", String(meta.omitted));
      res.setHeader("X-Analytics-Truncated", String(meta.truncated));
      res.setHeader("X-Analytics-Anchor", meta.anchor);
      res.setHeader("X-Analytics-Bucket", meta.bucket ? meta.bucket.label : "none");
      res.setHeader("Access-Control-Expose-Headers", TRUNCATION_HEADERS.join(", "));
    }

    if (envelope) {
      // Typed against the shared contract, so the body the UI parses and the
      // body this writes cannot drift apart silently.
      const body: AnalyticsHistoryEnvelope = { meta: meta ?? null, rows };
      res.json(body);
      return;
    }

    res.json(rows);
  });

  /**
   * POST /analytics/reset
   * Resets all accumulated analytics data.
   */
  router.post("/analytics/reset", (_req, res) => {
    vehicleManager.analytics.resetStats();
    res.json({ ok: true });
  });

  return router;
}

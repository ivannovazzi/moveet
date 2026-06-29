import express from "express";
import compression from "compression";
import cors from "cors";
import { PluginManager } from "./plugins/manager";
import { validateVehicleUpdates } from "./validation/vehicleUpdate";
import { REALISM_SCHEMA } from "./realism/config";
import { loadConfig, logConfig } from "./utils/config";
import { createLogger } from "./utils/logger";
import { correlationIdMiddleware } from "./middleware/correlationId";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { EmitJobRunner } from "./replay/emitJob";

const logger = createLogger("index");

// Source plugins
import { GraphQLSource } from "./plugins/sources/graphql";
import { RestSource } from "./plugins/sources/rest";
import { MySQLSource } from "./plugins/sources/mysql";
import { PostgresSource } from "./plugins/sources/postgres";
import { StaticSource } from "./plugins/sources/static";

// Sink plugins
import { GraphQLSink } from "./plugins/sinks/graphql";
import { RestSink } from "./plugins/sinks/rest";
import { RedpandaSink } from "./plugins/sinks/redpanda";
import { RedisPubSubSink } from "./plugins/sinks/redis";
import { WebhookSink } from "./plugins/sinks/webhook";
import { ConsoleSink } from "./plugins/sinks/console";

const pluginManager = new PluginManager();

// Register all available plugins
pluginManager.registerSource("graphql", () => new GraphQLSource());
pluginManager.registerSource("rest", () => new RestSource());
pluginManager.registerSource("mysql", () => new MySQLSource());
pluginManager.registerSource("postgres", () => new PostgresSource());
pluginManager.registerSource("static", () => new StaticSource());

pluginManager.registerSink("graphql", () => new GraphQLSink());
pluginManager.registerSink("rest", () => new RestSink());
pluginManager.registerSink("redpanda", () => new RedpandaSink());
pluginManager.registerSink("redis", () => new RedisPubSubSink());
pluginManager.registerSink("webhook", () => new WebhookSink());
pluginManager.registerSink("console", () => new ConsoleSink());

async function startup(): Promise<void> {
  const config = loadConfig();
  logConfig(config);

  // Wire the source resiliently: a source whose backend is unreachable at
  // startup (e.g. the fleet connector or a DB being down) must NOT take the
  // adapter down. It is logged and left unset; it can be (re)configured via the
  // API/UI once its backend is reachable.
  try {
    await pluginManager.setSource(config.source.type, config.source.config);
    logger.info({ source: config.source.type }, "Source configured");
  } catch (err) {
    logger.error(
      { source: config.source.type, err: err instanceof Error ? err.message : err },
      "Source failed to connect at startup — continuing without it; configure it via the API/UI once its backend is reachable"
    );
  }

  // Apply startup realism config (starts the engine scheduler if enabled).
  pluginManager.setRealismConfig(config.realism);
  logger.info({ enabled: pluginManager.getRealismStatus().enabled }, "Realism configured");

  // Wire sinks resiliently: a sink whose backend is unreachable at startup
  // (e.g. a Kafka broker that is down) must NOT take the whole adapter down,
  // otherwise the service — and the UI's adapter panel — become unreachable.
  // The failed sink is skipped and logged; it can be (re)added via the API/UI
  // once its backend is available.
  for (const sink of config.sinks) {
    try {
      await pluginManager.addSink(sink.type, sink.config);
      logger.info({ sink: sink.type }, "Sink configured");
    } catch (err) {
      logger.error(
        { sink: sink.type, err: err instanceof Error ? err.message : err },
        "Sink failed to connect at startup — skipping; add it via the API/UI once its backend is reachable"
      );
    }
  }

  // A sink whose broker dies AFTER startup would otherwise stay broken forever
  // (publishes report partial/failure indefinitely). Periodically health-check
  // active sinks and reconnect any that recover.
  pluginManager.startSinkReconnectLoop();

  // Replay/emit background job runner: fetches a recording from the simulator
  // and re-emits it (back-dated) through the configured sinks.
  const emitJob = new EmitJobRunner({
    simulatorUrl: config.simulatorUrl,
    publish: (updates) => pluginManager.publishToSinks(updates),
    realismConfig: config.realism,
  });

  let isReady = false;

  const app = express();
  app.use(
    cors({
      origin: config.corsOrigins === "*" ? "*" : config.corsOrigins,
    })
  );
  app.use(compression());
  // Cap the request body. /sync carries one position update per fleet vehicle;
  // 1 MB comfortably holds thousands of updates while bounding memory and
  // refusing accidental/abusive oversized payloads. Note for infra: a real
  // rate limiter on the mutating endpoints (/sync, /config/*, /replay/emit) is
  // still recommended — no rate-limit dependency is bundled here, so it is left
  // to the ingress/proxy layer.
  app.use(express.json({ limit: "1mb" }));
  app.use(correlationIdMiddleware);

  app.use((req, res, next) => {
    if (!isReady && req.path !== "/health") {
      res.status(503).json({ error: "Service unavailable, plugins initializing" });
      return;
    }
    next();
  });

  // === Data Endpoints ===

  app.get("/vehicles", async (_req, res) => {
    try {
      const vehicles = await pluginManager.getVehicles();
      res.json(vehicles);
    } catch (error) {
      res.locals.logger.error({ err: error }, "Error fetching vehicles");
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });

  app.get("/fleets", async (_req, res) => {
    try {
      const fleets = await pluginManager.getFleets();
      res.json(fleets);
    } catch (error) {
      logger.error({ err: error }, "Error fetching fleets");
      res.status(500).json({ error: "Failed to fetch fleets" });
    }
  });

  app.post("/sync", async (req, res) => {
    let rawVehicles: unknown[];
    if (Array.isArray(req.body)) {
      rawVehicles = req.body;
    } else if (req.body.vehicles && Array.isArray(req.body.vehicles)) {
      rawVehicles = req.body.vehicles;
    } else {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const { vehicles, invalid } = validateVehicleUpdates(rawVehicles);
    if (invalid.length > 0) {
      res.status(400).json({ error: "Invalid vehicle updates", details: invalid });
      return;
    }

    try {
      const result = await pluginManager.publishUpdates(vehicles);
      // Realism-enabled path returns {status:"accepted"} (async emission via the
      // engine scheduler); 202 is in the 2xx range so the simulator's
      // Adapter.request (which only throws on !response.ok) treats it as success.
      if (result.status === "accepted") {
        res.status(202).json({ status: "accepted", count: vehicles.length });
        return;
      }
      // result is now narrowed to PublishResult
      const httpStatus = result.status === "failure" ? 502 : 200;
      res
        .status(httpStatus)
        .json({ status: result.status, count: vehicles.length, sinks: result.sinks });
    } catch (error) {
      res.locals.logger.error({ err: error }, "Error publishing updates");
      res.status(500).json({ error: "Failed to publish updates" });
    }
  });

  // === Plugin Config API ===

  app.get("/config", async (_req, res) => {
    const status = await pluginManager.getStatus();
    res.json({
      ...pluginManager.getSafeConfig(),
      status,
      realism: {
        config: pluginManager.getRealismConfig(),
        schema: REALISM_SCHEMA,
        status: pluginManager.getRealismStatus(),
      },
    });
  });

  app.post("/config/source", async (req, res) => {
    const { type, config: pluginConfig } = req.body;
    if (!type) {
      res.status(400).json({ error: "Missing 'type' field" });
      return;
    }
    if (pluginConfig != null && (typeof pluginConfig !== "object" || Array.isArray(pluginConfig))) {
      res.status(400).json({ error: "'config' must be a JSON object" });
      return;
    }
    try {
      await pluginManager.setSource(type, pluginConfig || {});
      const status = await pluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/config/sinks", async (req, res) => {
    const { type, config: pluginConfig } = req.body;
    if (!type) {
      res.status(400).json({ error: "Missing 'type' field" });
      return;
    }
    if (pluginConfig != null && (typeof pluginConfig !== "object" || Array.isArray(pluginConfig))) {
      res.status(400).json({ error: "'config' must be a JSON object" });
      return;
    }
    try {
      await pluginManager.addSink(type, pluginConfig || {});
      const status = await pluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: msg });
    }
  });

  app.delete("/config/sinks/:type", async (req, res) => {
    try {
      await pluginManager.removeSink(req.params.type);
      const status = await pluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: msg });
    }
  });

  app.post("/config/realism", async (req, res) => {
    const { config: realismConfig } = req.body ?? {};
    if (
      realismConfig != null &&
      (typeof realismConfig !== "object" || Array.isArray(realismConfig))
    ) {
      res.status(400).json({ error: "'config' must be a JSON object" });
      return;
    }
    try {
      const applied = pluginManager.setRealismConfig(realismConfig ?? {});
      res.json({
        ok: true,
        realism: { config: applied, status: pluginManager.getRealismStatus() },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(400).json({ error: msg });
    }
  });

  // === Replay / Emit API ===

  app.post("/replay/emit", (req, res) => {
    const { recordingId, realism, seed } = req.body ?? {};
    if (typeof recordingId !== "number" || !Number.isInteger(recordingId)) {
      res.status(400).json({ error: "'recordingId' must be an integer" });
      return;
    }
    if (realism !== "on" && realism !== "off") {
      res.status(400).json({ error: "'realism' must be 'on' or 'off'" });
      return;
    }
    if (seed != null && typeof seed !== "number") {
      res.status(400).json({ error: "'seed', when present, must be a number" });
      return;
    }
    const jobId = emitJob.start({ recordingId, realism, seed });
    if (jobId === null) {
      res.status(409).json({ error: "An emit job is already running" });
      return;
    }
    res.status(202).json({ status: "emitting", jobId });
  });

  app.get("/replay/emit/status", (_req, res) => {
    res.json(emitJob.getStatus());
  });

  app.get("/health", async (_req, res) => {
    const status = await pluginManager.getStatus();
    res.json({ ...status, realism: pluginManager.getRealismStatus() });
  });

  // Final error handler: catches sync throws and (in Express 5) rejected
  // async handlers, returning structured JSON instead of the HTML error page.
  app.use(errorHandlerMiddleware);

  isReady = true;
  logger.info("All plugins initialized, server is ready");

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, `Adapter listening on http://localhost:${config.port}`);
  });

  /** Overall shutdown budget (HTTP drain + plugin shutdown combined) before we force-exit. */
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  /** Minimum slice a shutdown phase always gets, even if earlier phases ate the budget. */
  const SHUTDOWN_PHASE_FLOOR_MS = 100;

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, "Shutting down");

    // Single overall deadline shared by both phases so total shutdown time
    // stays within SHUTDOWN_TIMEOUT_MS (Docker's default stop grace period).
    // Each phase gets only the remaining budget, floored so the plugin phase
    // always gets a chance even if the drain consumed the full budget.
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    const remainingMs = (): number => Math.max(SHUTDOWN_PHASE_FLOOR_MS, deadline - Date.now());

    // Stop accepting new connections and drain in-flight requests first.
    // Bounded: a stuck in-flight request must not hang shutdown forever.
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        logger.warn("Server drain timed out — closing remaining connections");
        server.closeAllConnections();
        resolve();
      }, remainingMs());
      t.unref();
      server.close(() => {
        clearTimeout(t);
        resolve();
      });
      server.closeIdleConnections();
    });

    try {
      const pluginBudgetMs = remainingMs();
      await Promise.race([
        pluginManager.shutdown(),
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error(`Plugin shutdown timed out after ${pluginBudgetMs}ms`)),
            pluginBudgetMs
          );
          t.unref();
        }),
      ]);
      process.exit(exitCode);
    } catch (err) {
      logger.warn({ err }, "Error during shutdown — forcing exit");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    if (shuttingDown) {
      // shutdown() is re-entry guarded, so a second uncaught exception would
      // otherwise be swallowed, leaving a corrupt process running. Bail out.
      logger.error({ err }, "Uncaught exception during shutdown — exiting immediately");
      process.exit(1);
    }
    logger.error({ err }, "Uncaught exception — attempting clean shutdown");
    void shutdown("uncaughtException", 1);
  });
}

startup().catch((err) => {
  logger.error({ err }, "Failed to start adapter");
  process.exit(1);
});

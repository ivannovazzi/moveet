import express from "express";
import compression from "compression";
import cors from "cors";
import type { VehicleUpdate } from "./types";
import { PluginManager } from "./plugins/manager";
import { loadConfig, logConfig } from "./utils/config";
import { createLogger } from "./utils/logger";
import { correlationIdMiddleware } from "./middleware/correlationId";

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

  await pluginManager.setSource(config.source.type, config.source.config);
  logger.info({ source: config.source.type }, "Source configured");

  for (const sink of config.sinks) {
    await pluginManager.addSink(sink.type, sink.config);
    logger.info({ sink: sink.type }, "Sink configured");
  }

  const app = express();
  app.use(
    cors({
      origin: config.corsOrigins === "*" ? "*" : config.corsOrigins,
    })
  );
  app.use(compression());
  app.use(express.json());
  app.use(correlationIdMiddleware);

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
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/sync", async (req, res) => {
    let vehicles: VehicleUpdate[];
    if (Array.isArray(req.body)) {
      vehicles = req.body;
    } else if (req.body.vehicles && Array.isArray(req.body.vehicles)) {
      vehicles = req.body.vehicles;
    } else {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    try {
      const result = await pluginManager.publishUpdates(vehicles);
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
    res.json({ ...pluginManager.getSafeConfig(), status });
  });

  app.post("/config/source", async (req, res) => {
    const { type, config: pluginConfig } = req.body;
    if (!type) {
      res.status(400).json({ error: "Missing 'type' field" });
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

  app.get("/health", async (_req, res) => {
    const status = await pluginManager.getStatus();
    res.json(status);
  });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM signal received: shutting down");
    await pluginManager.shutdown();
    process.exit(0);
  });

  app.listen(config.port, () => {
    logger.info({ port: config.port }, `Adapter listening on http://localhost:${config.port}`);
  });
}

startup().catch((err) => {
  logger.error({ err }, "Failed to start adapter");
  process.exit(1);
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock all external dependencies to test the route handlers in isolation
const mockPluginManager = {
  getVehicles: vi.fn(),
  getFleets: vi.fn(),
  publishUpdates: vi.fn(),
  getStatus: vi.fn(),
  getSafeConfig: vi.fn(),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  shutdown: vi.fn(),
};

/**
 * Passthrough correlationId middleware for tests.
 */
function testCorrelationId(_req: any, res: any, next: () => void) {
  res.locals.requestId = "test-request-id";
  res.locals.logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  next();
}

/**
 * Build a test Express app that replicates the adapter's route structure
 * without running the full startup() lifecycle.
 */
function createAdapterApp({ isReady = true }: { isReady?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use(testCorrelationId);

  // 503 guard middleware
  app.use((req: any, res: any, next: () => void) => {
    if (!isReady && req.path !== "/health") {
      res.status(503).json({ error: "Service unavailable, plugins initializing" });
      return;
    }
    next();
  });

  // Data endpoints
  app.get("/vehicles", async (_req, res) => {
    try {
      const vehicles = await mockPluginManager.getVehicles();
      res.json(vehicles);
    } catch {
      res.locals.logger.error("Error fetching vehicles");
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });

  app.get("/fleets", async (_req, res) => {
    try {
      const fleets = await mockPluginManager.getFleets();
      res.json(fleets);
    } catch {
      res.status(500).json({ error: "Failed to fetch fleets" });
    }
  });

  app.post("/sync", async (req, res) => {
    let vehicles: any[];
    if (Array.isArray(req.body)) {
      vehicles = req.body;
    } else if (req.body.vehicles && Array.isArray(req.body.vehicles)) {
      vehicles = req.body.vehicles;
    } else {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const invalid: string[] = [];
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (
        typeof v.id !== "string" ||
        typeof v.latitude !== "number" ||
        typeof v.longitude !== "number"
      ) {
        invalid.push(
          `vehicles[${i}]: missing or invalid id (string), latitude (number), or longitude (number)`
        );
      }
    }
    if (invalid.length > 0) {
      res.status(400).json({ error: "Invalid vehicle updates", details: invalid });
      return;
    }

    try {
      const result = await mockPluginManager.publishUpdates(vehicles);
      const httpStatus = result.status === "failure" ? 502 : 200;
      res
        .status(httpStatus)
        .json({ status: result.status, count: vehicles.length, sinks: result.sinks });
    } catch {
      res.locals.logger.error("Error publishing updates");
      res.status(500).json({ error: "Failed to publish updates" });
    }
  });

  // Config endpoints
  app.get("/config", async (_req, res) => {
    const status = await mockPluginManager.getStatus();
    res.json({ ...mockPluginManager.getSafeConfig(), status });
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
      await mockPluginManager.setSource(type, pluginConfig || {});
      const status = await mockPluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Unknown error" });
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
      await mockPluginManager.addSink(type, pluginConfig || {});
      const status = await mockPluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Unknown error" });
    }
  });

  app.delete("/config/sinks/:type", async (req, res) => {
    try {
      await mockPluginManager.removeSink(req.params.type);
      const status = await mockPluginManager.getStatus();
      res.json({ ok: true, status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Unknown error" });
    }
  });

  app.get("/health", async (_req, res) => {
    const status = await mockPluginManager.getStatus();
    res.json(status);
  });

  return app;
}

describe("Adapter routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPluginManager.getVehicles.mockResolvedValue([
      { id: "v1", latitude: -1.3, longitude: 36.8 },
    ]);
    mockPluginManager.getFleets.mockResolvedValue([{ id: "f1", name: "Fleet 1" }]);
    mockPluginManager.getStatus.mockResolvedValue({ source: "rest", sinks: ["console"] });
    mockPluginManager.getSafeConfig.mockReturnValue({ source: { type: "rest" } });
    mockPluginManager.publishUpdates.mockResolvedValue({
      status: "success",
      sinks: ["console"],
    });
  });

  describe("503 guard", () => {
    it("should return 503 for non-health endpoints when not ready", async () => {
      const app = createAdapterApp({ isReady: false });
      const res = await request(app).get("/vehicles");
      expect(res.status).toBe(503);
      expect(res.body.error).toContain("unavailable");
    });

    it("should allow /health when not ready", async () => {
      const app = createAdapterApp({ isReady: false });
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /vehicles", () => {
    it("should return vehicles from plugin manager", async () => {
      const app = createAdapterApp();
      const res = await request(app).get("/vehicles");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe("v1");
    });

    it("should return 500 when plugin manager throws", async () => {
      mockPluginManager.getVehicles.mockRejectedValue(new Error("Source down"));
      const app = createAdapterApp();
      const res = await request(app).get("/vehicles");
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Failed to fetch");
    });
  });

  describe("GET /fleets", () => {
    it("should return fleets from plugin manager", async () => {
      const app = createAdapterApp();
      const res = await request(app).get("/fleets");
      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe("f1");
    });

    it("should return 500 when plugin manager throws", async () => {
      mockPluginManager.getFleets.mockRejectedValue(new Error("Source down"));
      const app = createAdapterApp();
      const res = await request(app).get("/fleets");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /sync", () => {
    const validPayload = [{ id: "v1", latitude: -1.3, longitude: 36.8 }];

    it("should accept array body", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/sync").send(validPayload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("success");
      expect(res.body.count).toBe(1);
    });

    it("should accept { vehicles: [...] } body", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/sync").send({ vehicles: validPayload });
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it("should reject invalid body format", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/sync").send({ foo: "bar" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid request body");
    });

    it("should validate vehicle updates", async () => {
      const app = createAdapterApp();
      const res = await request(app)
        .post("/sync")
        .send([{ id: 123, latitude: "bad", longitude: 36.8 }]);
      expect(res.status).toBe(400);
      expect(res.body.details).toHaveLength(1);
    });

    it("should return 502 on sink failure", async () => {
      mockPluginManager.publishUpdates.mockResolvedValue({
        status: "failure",
        sinks: ["console"],
      });
      const app = createAdapterApp();
      const res = await request(app).post("/sync").send(validPayload);
      expect(res.status).toBe(502);
    });

    it("should return 500 when publish throws", async () => {
      mockPluginManager.publishUpdates.mockRejectedValue(new Error("Kafka down"));
      const app = createAdapterApp();
      const res = await request(app).post("/sync").send(validPayload);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /config", () => {
    it("should return safe config with status", async () => {
      const app = createAdapterApp();
      const res = await request(app).get("/config");
      expect(res.status).toBe(200);
      expect(res.body.source).toBeDefined();
      expect(res.body.status).toBeDefined();
    });
  });

  describe("POST /config/source", () => {
    it("should set source plugin", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/config/source").send({ type: "rest", config: {} });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("should reject missing type", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/config/source").send({ config: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("type");
    });

    it("should reject array config", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/config/source").send({ type: "rest", config: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("config");
    });

    it("should return 400 when setSource throws", async () => {
      mockPluginManager.setSource.mockRejectedValue(new Error("Unknown source type"));
      const app = createAdapterApp();
      const res = await request(app).post("/config/source").send({ type: "bad" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Unknown source type");
    });
  });

  describe("POST /config/sinks", () => {
    it("should add sink plugin", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/config/sinks").send({ type: "console", config: {} });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("should reject missing type", async () => {
      const app = createAdapterApp();
      const res = await request(app).post("/config/sinks").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /config/sinks/:type", () => {
    it("should remove a sink", async () => {
      const app = createAdapterApp();
      const res = await request(app).delete("/config/sinks/console");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("should return 400 when removal fails", async () => {
      mockPluginManager.removeSink.mockRejectedValue(new Error("Sink not found"));
      const app = createAdapterApp();
      const res = await request(app).delete("/config/sinks/unknown");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /health", () => {
    it("should return plugin status", async () => {
      const app = createAdapterApp();
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("rest");
    });
  });
});

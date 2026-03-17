import { describe, it, expect, vi } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import {
  startSchema,
  optionsSchema,
  directionSchema,
  coordinatesSchema,
  searchSchema,
  createIncidentSchema,
  incidentAtPositionSchema,
  replayStartSchema,
  replaySeekSchema,
  replaySpeedSchema,
  clockSchema,
  trafficProfileSchema,
  createFleetSchema,
  fleetAssignSchema,
} from "../middleware/schemas";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ─── Helper: tiny Express app that applies a single validateBody ─────

function makeApp(schema: Parameters<typeof validateBody>[0]) {
  const app = express();
  app.use(express.json());
  app.post("/test", validateBody(schema), (req: Request, res: Response) => {
    res.json({ ok: true, body: req.body });
  });
  // Error handler so Express doesn't swallow unexpected errors
  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  return app;
}

// ─── validateBody middleware ─────────────────────────────────────────

describe("validateBody middleware", () => {
  it("should call next() when body is valid", async () => {
    const app = makeApp(searchSchema);
    const res = await request(app).post("/test").send({ query: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body.query).toBe("hello");
  });

  it("should return 400 with details when body is invalid", async () => {
    const app = makeApp(searchSchema);
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("should replace req.body with parsed data (defaults applied)", async () => {
    const app = makeApp(startSchema);
    const res = await request(app).post("/test").send(undefined);
    expect(res.status).toBe(200);
    // startSchema defaults to {} when body is undefined/null
    expect(res.body.ok).toBe(true);
  });
});

// ─── validateQuery middleware ────────────────────────────────────────

describe("validateQuery middleware", () => {
  it("should validate query params", async () => {
    const app = express();
    app.use(express.json());
    const { z } = await import("zod");
    const querySchema = z.object({ page: z.string() });
    app.get("/test", validateQuery(querySchema), (req: Request, res: Response) => {
      res.json({ ok: true, query: req.query });
    });

    const res = await request(app).get("/test?page=1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should return 400 for invalid query params", async () => {
    const app = express();
    app.use(express.json());
    const { z } = await import("zod");
    const querySchema = z.object({ page: z.string() });
    app.get("/test", validateQuery(querySchema), (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const res = await request(app).get("/test");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

// ─── validateParams middleware ───────────────────────────────────────

describe("validateParams middleware", () => {
  it("should validate route params", async () => {
    const app = express();
    app.use(express.json());
    const { z } = await import("zod");
    const paramSchema = z.object({ id: z.string().min(1) });
    app.get("/test/:id", validateParams(paramSchema), (req: Request, res: Response) => {
      res.json({ ok: true, id: req.params.id });
    });

    const res = await request(app).get("/test/abc");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("abc");
  });
});

// ─── Schema: startSchema ────────────────────────────────────────────

describe("startSchema", () => {
  const app = makeApp(startSchema);

  it("accepts empty body (defaults to {})", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(200);
  });

  it("accepts valid partial options", async () => {
    const res = await request(app).post("/test").send({
      minSpeed: 10,
      maxSpeed: 80,
      updateInterval: 250,
    });
    expect(res.status).toBe(200);
    expect(res.body.body.minSpeed).toBe(10);
  });

  it("accepts vehicleTypes map", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        vehicleTypes: { car: 5, truck: 3 },
      });
    expect(res.status).toBe(200);
    expect(res.body.body.vehicleTypes).toEqual({ car: 5, truck: 3 });
  });

  it("rejects unknown keys (strict mode)", async () => {
    const res = await request(app).post("/test").send({
      unknownField: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("rejects speedVariation > 1", async () => {
    const res = await request(app).post("/test").send({
      speedVariation: 1.5,
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-positive updateInterval", async () => {
    const res = await request(app).post("/test").send({
      updateInterval: 0,
    });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: optionsSchema ──────────────────────────────────────────

describe("optionsSchema", () => {
  const app = makeApp(optionsSchema);

  it("accepts a complete valid options object", async () => {
    const res = await request(app).post("/test").send({
      minSpeed: 20,
      maxSpeed: 60,
      speedVariation: 0.1,
      acceleration: 5,
      deceleration: 7,
      turnThreshold: 30,
      heatZoneSpeedFactor: 0.5,
      updateInterval: 500,
    });
    expect(res.status).toBe(200);
  });

  it("rejects missing required fields", async () => {
    const res = await request(app).post("/test").send({
      minSpeed: 20,
    });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("rejects non-numeric fields", async () => {
    const res = await request(app).post("/test").send({
      minSpeed: "fast",
      maxSpeed: 60,
      speedVariation: 0.1,
      acceleration: 5,
      deceleration: 7,
      turnThreshold: 30,
      heatZoneSpeedFactor: 0.5,
      updateInterval: 500,
    });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: directionSchema ────────────────────────────────────────

describe("directionSchema", () => {
  const app = makeApp(directionSchema);

  it("accepts valid single-destination direction", async () => {
    const res = await request(app)
      .post("/test")
      .send([{ id: "v1", lat: 45.5, lng: -73.5 }]);
    expect(res.status).toBe(200);
  });

  it("accepts valid multi-waypoint direction", async () => {
    const res = await request(app)
      .post("/test")
      .send([
        {
          id: "v1",
          waypoints: [
            { lat: 45.5, lng: -73.5 },
            { lat: 45.6, lng: -73.4, dwellTime: 30, label: "Stop A" },
          ],
        },
      ]);
    expect(res.status).toBe(200);
  });

  it("rejects empty array", async () => {
    const res = await request(app).post("/test").send([]);
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("non-empty"))).toBe(true);
  });

  it("rejects non-array body", async () => {
    const res = await request(app).post("/test").send({ id: "v1" });
    expect(res.status).toBe(400);
  });

  it("rejects item with empty id", async () => {
    const res = await request(app)
      .post("/test")
      .send([{ id: "", lat: 45.5, lng: -73.5 }]);
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("id"))).toBe(true);
  });

  it("rejects item with missing id", async () => {
    const res = await request(app)
      .post("/test")
      .send([{ lat: 45.5, lng: -73.5 }]);
    expect(res.status).toBe(400);
  });

  it("rejects waypoint with non-numeric lat", async () => {
    const res = await request(app)
      .post("/test")
      .send([
        {
          id: "v1",
          waypoints: [{ lat: "bad", lng: -73.5 }],
        },
      ]);
    expect(res.status).toBe(400);
  });
});

// ─── Schema: coordinatesSchema ──────────────────────────────────────

describe("coordinatesSchema", () => {
  const app = makeApp(coordinatesSchema);

  it("accepts valid [lon, lat] tuple", async () => {
    const res = await request(app).post("/test").send([-73.5, 45.5]);
    expect(res.status).toBe(200);
  });

  it("rejects non-array body", async () => {
    const res = await request(app).post("/test").send({ x: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects array with wrong length", async () => {
    const res = await request(app).post("/test").send([1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it("rejects array with non-numbers", async () => {
    const res = await request(app).post("/test").send(["a", "b"]);
    expect(res.status).toBe(400);
  });
});

// ─── Schema: searchSchema ───────────────────────────────────────────

describe("searchSchema", () => {
  const app = makeApp(searchSchema);

  it("accepts valid search query", async () => {
    const res = await request(app).post("/test").send({ query: "Main Street" });
    expect(res.status).toBe(200);
  });

  it("rejects empty query string", async () => {
    const res = await request(app).post("/test").send({ query: "" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("query"))).toBe(true);
  });

  it("rejects missing query field", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-string query", async () => {
    const res = await request(app).post("/test").send({ query: 123 });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: createIncidentSchema ───────────────────────────────────

describe("createIncidentSchema", () => {
  const app = makeApp(createIncidentSchema);

  it("accepts valid incident without severity", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1", "e2"],
        type: "accident",
        duration: 60000,
      });
    expect(res.status).toBe(200);
  });

  it("accepts valid incident with severity", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "closure",
        duration: 30000,
        severity: 0.8,
      });
    expect(res.status).toBe(200);
  });

  it("rejects empty edgeIds array", async () => {
    const res = await request(app).post("/test").send({
      edgeIds: [],
      type: "accident",
      duration: 60000,
    });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("edgeIds"))).toBe(true);
  });

  it("rejects invalid incident type", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "fire",
        duration: 60000,
      });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("type"))).toBe(true);
  });

  it("rejects non-positive duration", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "accident",
        duration: 0,
      });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("duration"))).toBe(true);
  });

  it("rejects negative duration", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "accident",
        duration: -100,
      });
    expect(res.status).toBe(400);
  });

  it("rejects severity > 1", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "accident",
        duration: 5000,
        severity: 1.5,
      });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("severity"))).toBe(true);
  });

  it("rejects severity < 0", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "accident",
        duration: 5000,
        severity: -0.1,
      });
    expect(res.status).toBe(400);
  });

  it("rejects missing edgeIds", async () => {
    const res = await request(app).post("/test").send({
      type: "accident",
      duration: 5000,
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing type", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        duration: 5000,
      });
    expect(res.status).toBe(400);
  });

  it("rejects missing duration", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: ["e1"],
        type: "accident",
      });
    expect(res.status).toBe(400);
  });

  it("accepts all three valid incident types", async () => {
    for (const type of ["accident", "closure", "construction"]) {
      const res = await request(app)
        .post("/test")
        .send({
          edgeIds: ["e1"],
          type,
          duration: 5000,
        });
      expect(res.status).toBe(200);
    }
  });
});

// ─── Schema: incidentAtPositionSchema ───────────────────────────────

describe("incidentAtPositionSchema", () => {
  const app = makeApp(incidentAtPositionSchema);

  it("accepts valid position incident", async () => {
    const res = await request(app).post("/test").send({
      lat: 45.5,
      lng: -73.5,
      type: "construction",
    });
    expect(res.status).toBe(200);
  });

  it("rejects missing lat", async () => {
    const res = await request(app).post("/test").send({
      lng: -73.5,
      type: "accident",
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing lng", async () => {
    const res = await request(app).post("/test").send({
      lat: 45.5,
      type: "accident",
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid type", async () => {
    const res = await request(app).post("/test").send({
      lat: 45.5,
      lng: -73.5,
      type: "earthquake",
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric lat", async () => {
    const res = await request(app).post("/test").send({
      lat: "not-a-number",
      lng: -73.5,
      type: "accident",
    });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: replayStartSchema ──────────────────────────────────────

describe("replayStartSchema", () => {
  const app = makeApp(replayStartSchema);

  it("accepts valid replay start with file only", async () => {
    const res = await request(app).post("/test").send({
      file: "recording-2024.ndjson",
    });
    expect(res.status).toBe(200);
  });

  it("accepts valid replay start with file and speed", async () => {
    const res = await request(app).post("/test").send({
      file: "recording.ndjson",
      speed: 2,
    });
    expect(res.status).toBe(200);
  });

  it("rejects missing file", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("file"))).toBe(true);
  });

  it("rejects empty file string", async () => {
    const res = await request(app).post("/test").send({ file: "" });
    expect(res.status).toBe(400);
  });

  it("rejects non-string file", async () => {
    const res = await request(app).post("/test").send({ file: 123 });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: replaySeekSchema ───────────────────────────────────────

describe("replaySeekSchema", () => {
  const app = makeApp(replaySeekSchema);

  it("accepts valid timestamp", async () => {
    const res = await request(app).post("/test").send({ timestamp: 5000 });
    expect(res.status).toBe(200);
  });

  it("rejects missing timestamp", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric timestamp", async () => {
    const res = await request(app).post("/test").send({ timestamp: "five" });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: replaySpeedSchema ──────────────────────────────────────

describe("replaySpeedSchema", () => {
  const app = makeApp(replaySpeedSchema);

  it("accepts valid speed", async () => {
    const res = await request(app).post("/test").send({ speed: 2.5 });
    expect(res.status).toBe(200);
  });

  it("accepts missing speed (optional)", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(200);
  });

  it("rejects non-positive speed", async () => {
    const res = await request(app).post("/test").send({ speed: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects negative speed", async () => {
    const res = await request(app).post("/test").send({ speed: -1 });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: clockSchema ────────────────────────────────────────────

describe("clockSchema", () => {
  const app = makeApp(clockSchema);

  it("accepts valid speedMultiplier", async () => {
    const res = await request(app).post("/test").send({ speedMultiplier: 2 });
    expect(res.status).toBe(200);
  });

  it("accepts valid setTime", async () => {
    const res = await request(app).post("/test").send({
      setTime: "2024-01-15T10:30:00Z",
    });
    expect(res.status).toBe(200);
  });

  it("accepts both speedMultiplier and setTime", async () => {
    const res = await request(app).post("/test").send({
      speedMultiplier: 3,
      setTime: "2024-06-01T00:00:00Z",
    });
    expect(res.status).toBe(200);
  });

  it("accepts empty body (both optional)", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(200);
  });

  it("rejects negative speedMultiplier", async () => {
    const res = await request(app).post("/test").send({
      speedMultiplier: -1,
    });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("speedMultiplier"))).toBe(true);
  });

  it("rejects invalid setTime", async () => {
    const res = await request(app).post("/test").send({
      setTime: "not-a-date",
    });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("setTime"))).toBe(true);
  });
});

// ─── Schema: trafficProfileSchema ───────────────────────────────────

describe("trafficProfileSchema", () => {
  const app = makeApp(trafficProfileSchema);

  it("accepts valid traffic profile", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        name: "rush-hour",
        timeRanges: [
          {
            start: 7,
            end: 9,
            demandMultiplier: 1.5,
            affectedHighways: ["primary", "secondary"],
          },
        ],
      });
    expect(res.status).toBe(200);
  });

  it("rejects missing name", async () => {
    const res = await request(app).post("/test").send({
      timeRanges: [],
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing timeRanges", async () => {
    const res = await request(app).post("/test").send({
      name: "test",
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-array timeRanges", async () => {
    const res = await request(app).post("/test").send({
      name: "test",
      timeRanges: "not-an-array",
    });
    expect(res.status).toBe(400);
  });

  it("accepts empty timeRanges array", async () => {
    const res = await request(app).post("/test").send({
      name: "empty-profile",
      timeRanges: [],
    });
    expect(res.status).toBe(200);
  });
});

// ─── Schema: createFleetSchema ──────────────────────────────────────

describe("createFleetSchema", () => {
  const app = makeApp(createFleetSchema);

  it("accepts valid fleet with name only", async () => {
    const res = await request(app).post("/test").send({ name: "Alpha" });
    expect(res.status).toBe(200);
  });

  it("accepts valid fleet with name and source", async () => {
    const res = await request(app).post("/test").send({
      name: "Beta",
      source: "external",
    });
    expect(res.status).toBe(200);
  });

  it("rejects missing name", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("name"))).toBe(true);
  });

  it("rejects empty name", async () => {
    const res = await request(app).post("/test").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects non-string name", async () => {
    const res = await request(app).post("/test").send({ name: 123 });
    expect(res.status).toBe(400);
  });

  it("rejects invalid source value", async () => {
    const res = await request(app).post("/test").send({
      name: "Fleet",
      source: "unknown",
    });
    expect(res.status).toBe(400);
  });
});

// ─── Schema: fleetAssignSchema ──────────────────────────────────────

describe("fleetAssignSchema", () => {
  const app = makeApp(fleetAssignSchema);

  it("accepts valid vehicleIds array", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        vehicleIds: ["v1", "v2"],
      });
    expect(res.status).toBe(200);
  });

  it("accepts empty vehicleIds array", async () => {
    const res = await request(app).post("/test").send({
      vehicleIds: [],
    });
    expect(res.status).toBe(200);
  });

  it("rejects missing vehicleIds", async () => {
    const res = await request(app).post("/test").send({});
    expect(res.status).toBe(400);
    expect(res.body.details.some((d: string) => d.includes("vehicleIds"))).toBe(true);
  });

  it("rejects non-array vehicleIds", async () => {
    const res = await request(app).post("/test").send({
      vehicleIds: "not-an-array",
    });
    expect(res.status).toBe(400);
  });

  it("rejects vehicleIds with non-string elements", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        vehicleIds: [1, 2, 3],
      });
    expect(res.status).toBe(400);
  });
});

// ─── Error message quality ──────────────────────────────────────────

describe("error message quality", () => {
  it("includes path in error details for nested fields", async () => {
    const app = makeApp(createIncidentSchema);
    const res = await request(app)
      .post("/test")
      .send({
        edgeIds: [123], // should be strings
        type: "accident",
        duration: 5000,
      });
    expect(res.status).toBe(400);
    // Should include a path reference to edgeIds
    expect(res.body.details.some((d: string) => d.includes("edgeIds"))).toBe(true);
  });

  it("returns multiple errors for multiple invalid fields", async () => {
    const app = makeApp(createIncidentSchema);
    const res = await request(app).post("/test").send({
      edgeIds: "not-array",
      type: "invalid",
      duration: -1,
    });
    expect(res.status).toBe(400);
    // Should have multiple detail messages
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });
});

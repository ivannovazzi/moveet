import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMapBuildRoutes } from "../../routes/mapBuilds";
import { createMapRoutes } from "../../routes/maps";
import { MapLibrary } from "../../modules/maps/MapLibrary";
import { MapBuildManager } from "../../modules/maps/MapBuildManager";
import { GeofabrikIndex, type FetchLike } from "../../modules/maps/GeofabrikIndex";
import { GeocodeRateLimitError, GeocodeUpstreamError } from "../../modules/maps/Geocoder";
import type { MapBuildRunner } from "../../modules/maps/MapBuildRunner";
import type { MapSwitcher } from "../../modules/maps/MapSwitcher";
import type { GeocodeResult } from "@moveet/shared-types";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "geofabrik-index.json"),
  "utf8"
);
const BERGAMO_BBOX = [9.64, 45.68, 9.7, 45.71];

let root: string;
let runner: ReturnType<typeof vi.fn<MapBuildRunner>>;
let search: ReturnType<typeof vi.fn<(q: string) => Promise<GeocodeResult[]>>>;

function app({ allowed = true } = {}) {
  const library = new MapLibrary(root);
  const geofabrik = new GeofabrikIndex({
    cacheDir: path.join(root, ".cache"),
    ttlMs: 60_000,
    userAgent: "test",
    fetch: async () => ({ ok: true, status: 200, text: async () => FIXTURE }),
  });
  const presets = {
    bergamo: {
      label: "Bergamo",
      bbox: [9.64, 45.68, 9.7, 45.71] as [number, number, number, number],
      geofabrik: "europe/italy/nord-ovest",
    },
  };
  const builds = new MapBuildManager({
    library,
    geofabrik,
    presets,
    runner,
    cacheDir: path.join(root, ".cache"),
    allowed,
    maxAreaKm2: 2500,
    diskQuotaBytes: 1024 * 1024 * 1024,
    maxQueued: 0,
    activate: async () => ({}),
  });
  const switcher = {
    getActiveId: () => "demo",
    isSwitching: false,
  } as unknown as MapSwitcher;
  const a = express();
  a.use(express.json());
  a.use(createMapBuildRoutes({ builds, geofabrik, geocoder: { search }, presets }));
  a.use(createMapRoutes({ library, switcher, builds }));
  return a;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-mapbuild-routes-"));
  // A build that never finishes on its own; cancel settles it.
  runner = vi.fn<MapBuildRunner>(() => {
    let reject!: (e: Error) => void;
    const result = new Promise<never>((_, rej) => {
      reject = rej;
    });
    return { result, cancel: () => reject(new Error("cancelled")) };
  });
  search = vi.fn(
    async (_q: string): Promise<GeocodeResult[]> => [
      { name: "Bergamo", bbox: [9.6, 45.6, 9.7, 45.7], center: [9.66, 45.69], type: "place/city" },
    ]
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /maps", () => {
  it("accepts a custom area with 202, a Location and the job", async () => {
    const res = await request(app())
      .post("/maps")
      .send({ label: "Bergamo", bbox: BERGAMO_BBOX, geofabrik: "europe/italy/nord-ovest" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: "running",
      label: "Bergamo",
      geofabrik: "europe/italy/nord-ovest",
      buildings: true,
      activate: false,
    });
    expect(res.headers.location).toBe(`/maps/jobs/${res.body.id}`);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("accepts a preset", async () => {
    const res = await request(app())
      .post("/maps")
      .send({ preset: "bergamo", buildings: false, activate: true });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ preset: "bergamo", buildings: false, activate: true });
  });

  it.each([
    ["an empty body", {}],
    ["a preset mixed with a custom area", { preset: "bergamo", bbox: BERGAMO_BBOX }],
    ["a missing geofabrik", { label: "x", bbox: BERGAMO_BBOX }],
    ["a three-value bbox", { label: "x", bbox: [1, 2, 3], geofabrik: "europe/italy" }],
    ["a latitude out of range", { label: "x", bbox: [0, 0, 1, 95], geofabrik: "europe/italy" }],
    [
      "a raw URL as geofabrik",
      { label: "x", bbox: BERGAMO_BBOX, geofabrik: "https://evil.example/x" },
    ],
    ["a path traversal", { label: "x", bbox: BERGAMO_BBOX, geofabrik: "../../etc/passwd" }],
    ["a blank label", { label: "  ", bbox: BERGAMO_BBOX, geofabrik: "europe/italy" }],
    ["a non-boolean flag", { preset: "bergamo", activate: "yes" }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await request(app()).post("/maps").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects an extract that is not in Geofabrik's index (allowlist)", async () => {
    const res = await request(app())
      .post("/maps")
      .send({ label: "x", bbox: BERGAMO_BBOX, geofabrik: "europe/atlantis" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not a Geofabrik extract/);
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects a bbox outside the named extract with 422", async () => {
    const res = await request(app())
      .post("/maps")
      .send({ label: "x", bbox: BERGAMO_BBOX, geofabrik: "europe/italy/nord-est" });
    expect(res.status).toBe(422);
  });

  it("rejects an unordered or oversized bbox with 400", async () => {
    const a = app();
    const unordered = await request(a)
      .post("/maps")
      .send({ label: "x", bbox: [9.7, 45.68, 9.64, 45.71], geofabrik: "europe/italy/nord-ovest" });
    expect(unordered.status).toBe(400);
    expect(unordered.body.error).toMatch(/west must be less than east/);
    const huge = await request(a)
      .post("/maps")
      .send({ label: "x", bbox: [7, 44, 10, 46], geofabrik: "europe/italy/nord-ovest" });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/km² limit/);
  });

  it("answers 409 while a build runs and the queue is full", async () => {
    const a = app();
    expect((await request(a).post("/maps").send({ preset: "bergamo" })).status).toBe(202);
    const res = await request(a).post("/maps").send({ preset: "bergamo" });
    expect(res.status).toBe(409);
  });

  it("answers 403 whatever the body when ALLOW_MAP_BUILDS=false", async () => {
    const res = await request(app({ allowed: false }))
      .post("/maps")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/ALLOW_MAP_BUILDS/);
  });
});

describe("map build jobs", () => {
  it("lists, gets and cancels a job", async () => {
    const a = app();
    const { body } = await request(a).post("/maps").send({ preset: "bergamo" });
    const id = body.id as string;

    const list = await request(a).get("/maps/jobs");
    expect(list.status).toBe(200);
    expect(list.body.jobs.map((j: { id: string }) => j.id)).toEqual([id]);

    expect((await request(a).get(`/maps/jobs/${id}`)).body.status).toBe("running");

    const cancel = await request(a).delete(`/maps/jobs/${id}`);
    expect(cancel.status).toBe(202);
    await new Promise((r) => setImmediate(r));
    expect((await request(a).get(`/maps/jobs/${id}`)).body.status).toBe("cancelled");

    expect((await request(a).delete(`/maps/jobs/${id}`)).status).toBe(409);
  });

  it("404s an unknown job and 400s a malformed id", async () => {
    const a = app();
    expect((await request(a).get("/maps/jobs/nope")).status).toBe(404);
    expect((await request(a).delete("/maps/jobs/nope")).status).toBe(404);
    expect((await request(a).get("/maps/jobs/bad%20id!")).status).toBe(400);
  });

  it("refuses cancellation with 403 when builds are disabled, but still lists jobs", async () => {
    const a = app({ allowed: false });
    expect((await request(a).delete("/maps/jobs/whatever")).status).toBe(403);
    expect((await request(a).get("/maps/jobs")).body).toEqual({ jobs: [] });
  });
});

describe("GET /maps build info", () => {
  it("reports buildsAllowed and the caps", async () => {
    const res = await request(app()).get("/maps");
    expect(res.status).toBe(200);
    expect(res.body.buildsAllowed).toBe(true);
    expect(res.body.buildLimits).toEqual({
      maxAreaKm2: 2500,
      diskQuotaBytes: 1024 * 1024 * 1024,
      diskUsedBytes: 0,
      cacheBytes: 0,
      maxQueuedJobs: 0,
    });
  });

  it("reports buildsAllowed: false when disabled", async () => {
    expect((await request(app({ allowed: false })).get("/maps")).body.buildsAllowed).toBe(false);
  });
});

describe("GET /maps/presets", () => {
  it("lists presets with their area", async () => {
    const res = await request(app()).get("/maps/presets");
    expect(res.status).toBe(200);
    expect(res.body.presets).toEqual([
      {
        name: "bergamo",
        label: "Bergamo",
        bbox: [9.64, 45.68, 9.7, 45.71],
        geofabrik: "europe/italy/nord-ovest",
        areaKm2: expect.any(Number),
      },
    ]);
    expect(res.body.presets[0].areaKm2).toBeGreaterThan(10);
    expect(res.body.presets[0].areaKm2).toBeLessThan(30);
  });
});

describe("GET /maps/geofabrik", () => {
  it("returns the covering extracts, smallest first", async () => {
    const res = await request(app())
      .get("/maps/geofabrik")
      .query({ bbox: BERGAMO_BBOX.join(",") });
    expect(res.status).toBe(200);
    expect(res.body.regions.map((r: { path: string }) => r.path)).toEqual([
      "europe/italy/nord-ovest",
      "europe/italy",
      "europe",
    ]);
  });

  it.each(["", "1,2,3", "a,b,c,d", "10,0,5,1", "0,0,1,1,2"])("rejects bbox=%j", async (bbox) => {
    const res = await request(app()).get("/maps/geofabrik").query({ bbox });
    expect(res.status).toBe(400);
  });

  it("answers 503 when the index cannot be fetched", async () => {
    const a = express();
    const geofabrik = new GeofabrikIndex({
      cacheDir: path.join(root, "empty"),
      ttlMs: 1,
      userAgent: "t",
      fetch: (async () => {
        throw new Error("offline");
      }) as FetchLike,
    });
    a.use(
      createMapBuildRoutes({
        builds: {} as MapBuildManager,
        geofabrik,
        geocoder: { search },
        presets: {},
      })
    );
    const res = await request(a).get("/maps/geofabrik").query({ bbox: "0,0,1,1" });
    expect(res.status).toBe(503);
  });
});

describe("GET /maps/geocode", () => {
  it("returns results with Nominatim's attribution", async () => {
    const res = await request(app()).get("/maps/geocode").query({ q: "Bergamo" });
    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith("Bergamo");
    expect(res.body.results[0].name).toBe("Bergamo");
    expect(res.body.attribution).toMatch(/OpenStreetMap/);
  });

  it("requires q", async () => {
    expect((await request(app()).get("/maps/geocode")).status).toBe(400);
    expect((await request(app()).get("/maps/geocode").query({ q: "a" })).status).toBe(400);
  });

  it("answers 429 with Retry-After when rate limited, 502 on upstream failure", async () => {
    search.mockRejectedValueOnce(new GeocodeRateLimitError());
    const limited = await request(app()).get("/maps/geocode").query({ q: "Bergamo" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("1");
    search.mockRejectedValueOnce(new GeocodeUpstreamError("HTTP 500"));
    expect((await request(app()).get("/maps/geocode").query({ q: "Bergamo" })).status).toBe(502);
  });
});

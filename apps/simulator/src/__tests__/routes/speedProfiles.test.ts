import { describe, it, expect, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import {
  createSpeedProfileRoutes,
  jsonBodyParser,
  SPEED_PROFILE_IMPORT_PATH,
} from "../../routes/speedProfiles";
import { RoadNetwork } from "../../modules/RoadNetwork";
import {
  SpeedProfileManager,
  type SpeedSource,
} from "../../modules/speedprofiles/SpeedProfileManager";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

vi.mock("../../utils/logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: log, createLogger: () => log };
});

const file = writeTmpNetwork(gridFeatures());
afterAll(() => fs.rmSync(file, { force: true }));
const network = new RoadNetwork(file, { landmarkCount: 0, speedProfileRatio: 1 });
const NOW = new Date(2026, 0, 5, 8, 0).getTime(); // Monday 08:00

function app(sources: SpeedSource[]) {
  const manager = new SpeedProfileManager(
    network,
    {
      sources,
      layout: { period: "week", bucketHours: 1 },
      minSamples: 1,
      alpha: 0.2,
      publishIntervalMs: 0,
    },
    () => NOW
  );
  const a = express();
  a.use(express.json());
  a.use(createSpeedProfileRoutes(manager));
  return { a, manager };
}

const west = gridPos(1, 0);
const centre = gridPos(1, 1);
const edge = () =>
  network.findNearestNode(west).connections.find((e) => e.end === network.findNearestNode(centre))!;

describe("speed profile routes", () => {
  it("GET /speed-profiles reports stats", async () => {
    const { a, manager } = app(["sim"]);
    manager.observe(edge(), 20, NOW, "sim");
    const res = await request(a).get("/speed-profiles");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sources: ["sim"],
      period: "week",
      bucketHours: 1,
      currentBucket: 32,
      observedEdges: 1,
      totalSamples: 1,
    });
  });

  it("exports a file that imports back (merge and replace)", async () => {
    const src = app(["sim"]);
    src.manager.observe(edge(), 20, NOW, "sim");
    const exported = await request(src.a).get("/speed-profiles/export");
    expect(exported.status).toBe(200);
    expect(exported.headers["content-disposition"]).toContain("speed-profiles");
    expect(exported.body.edges).toHaveLength(1);

    const dst = app(["sim"]);
    const merged = await request(dst.a).post("/speed-profiles/import").send(exported.body);
    expect(merged.status).toBe(200);
    expect(merged.body).toEqual({ mode: "merge", matchedEdges: 1, unmatchedEdges: 0, entries: 1 });

    const replaced = await request(dst.a)
      .post("/speed-profiles/import?mode=replace")
      .send({ ...exported.body, edges: [] });
    expect(replaced.body.mode).toBe("replace");
    expect(dst.manager.stats().observedEdges).toBe(0);
  });

  it("rejects malformed profile files and modes", async () => {
    const { a } = app(["sim"]);
    expect((await request(a).post("/speed-profiles/import").send({ format: "nope" })).status).toBe(
      400
    );
    const badLayout = {
      format: "moveet-speed-profiles",
      version: 1,
      period: "week",
      bucketHours: 5,
      edges: [],
    };
    expect((await request(a).post("/speed-profiles/import").send(badLayout)).status).toBe(400);
    const ok = { ...badLayout, bucketHours: 1 };
    expect((await request(a).post("/speed-profiles/import?mode=wipe").send(ok)).status).toBe(400);
  });

  it("POST /speed-profiles/observations needs the adapter source", async () => {
    const fixes = [
      { vehicleId: "r1", position: [west[0], west[1] + 0.0002], timestamp: NOW },
      { vehicleId: "r1", position: [west[0], west[1] + 0.0008], timestamp: NOW + 8_000 },
    ];
    const simOnly = app(["sim"]);
    expect(
      (await request(simOnly.a).post("/speed-profiles/observations").send({ fixes })).status
    ).toBe(409);

    const withAdapter = app(["adapter"]);
    const res = await request(withAdapter.a).post("/speed-profiles/observations").send({ fixes });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fixes: 2, observations: 1 });

    const bad = await request(withAdapter.a)
      .post("/speed-profiles/observations")
      .send({ fixes: [{ vehicleId: "r1", position: [200, 0], timestamp: NOW }] });
    expect(bad.status).toBe(400);
  });
});

describe("jsonBodyParser: the large import body limit", () => {
  // ~200 KB: over express's default 100 KB, far under the import limit.
  const bigBody = { edges: [], padding: "x".repeat(200_000) };

  function probe(speedProfilesEnabled: boolean) {
    const a = express();
    a.use(jsonBodyParser(speedProfilesEnabled));
    a.post(SPEED_PROFILE_IMPORT_PATH, (_req, res) => {
      res.json({ ok: true });
    });
    a.use((err: { status?: number }, _req: express.Request, res: express.Response, _n: unknown) => {
      res.status(err.status ?? 500).end();
    });
    return a;
  }

  it("accepts a large import body when speed profiles are enabled", async () => {
    const res = await request(probe(true)).post(SPEED_PROFILE_IMPORT_PATH).send(bigBody);
    expect(res.status).toBe(200);
  });

  it("keeps the default limit on the import path when speed profiles are disabled", async () => {
    const res = await request(probe(false)).post(SPEED_PROFILE_IMPORT_PATH).send(bigBody);
    expect(res.status).toBe(413);
  });
});

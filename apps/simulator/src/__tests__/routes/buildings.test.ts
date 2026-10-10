import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createBuildingRoutes } from "../../routes/buildings";

const tmpDirs: string[] = [];

/** A data dir under a dot-directory, like a `.claude/` worktree or `~/.local`. */
function dataDir(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-buildings-"));
  tmpDirs.push(base);
  const dir = path.join(base, ".hidden", "buildings");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function app(dir: string) {
  const a = express();
  a.use(createBuildingRoutes({ dir }));
  return a;
}

const INDEX = {
  version: 1,
  zoom: 14,
  scale: 1e6,
  bbox: [36.65, -1.45, 37.1, -1.15],
  buildings: 1,
  tiles: ["9867/8250"],
  region: "nairobi",
  source: "OpenStreetMap contributors, ODbL",
  generatedAt: "2026-10-10T00:00:00.000Z",
};
const TILE = { o: [36804000, -1296000], n: 1, b: [70, 3, 10, 10, 100, 0, 0, 100] };

function seed(dir: string) {
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(INDEX));
  fs.mkdirSync(path.join(dir, "14", "9867"), { recursive: true });
  fs.writeFileSync(path.join(dir, "14", "9867", "8250.json"), JSON.stringify(TILE));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("building routes", () => {
  it("GET /buildings returns 404 with a hint when no data was generated", async () => {
    const res = await request(app(path.join(dataDir(), "missing"))).get("/buildings");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/cli\.ts buildings/);
  });

  it("GET /buildings returns the index", async () => {
    const dir = dataDir();
    seed(dir);
    const res = await request(app(dir)).get("/buildings");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual(INDEX);
  });

  it("GET /buildings/:z/:x/:y serves a tile with a cache header", async () => {
    const dir = dataDir();
    seed(dir);
    const res = await request(app(dir)).get("/buildings/14/9867/8250");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["cache-control"]).toMatch(/max-age=300/);
    expect(res.body).toEqual(TILE);
  });

  it("GET /buildings/:z/:x/:y returns 404 for a tile that does not exist", async () => {
    const dir = dataDir();
    seed(dir);
    const res = await request(app(dir)).get("/buildings/14/9867/8251");
    expect(res.status).toBe(404);
  });

  it("rejects non-integer tile coordinates", async () => {
    const dir = dataDir();
    seed(dir);
    for (const url of ["/buildings/14/abc/1", "/buildings/14/-1/1", "/buildings/14/1/..%2Findex"]) {
      const res = await request(app(dir)).get(url);
      expect(res.status).toBe(400);
    }
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeofabrikIndex,
  GeofabrikUnavailableError,
  parseGeofabrikIndex,
  type FetchLike,
} from "../../modules/maps/GeofabrikIndex";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "geofabrik-index.json"),
  "utf8"
);
const BERGAMO: [number, number, number, number] = [9.64, 45.68, 9.7, 45.71];

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-geofabrik-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function okFetch(body = FIXTURE) {
  return vi.fn<FetchLike>(async () => ({ ok: true, status: 200, text: async () => body }));
}

function index(opts: Partial<ConstructorParameters<typeof GeofabrikIndex>[0]> = {}) {
  return new GeofabrikIndex({
    cacheDir: tmp(),
    ttlMs: 60_000,
    userAgent: "moveet-test",
    fetch: okFetch(),
    ...opts,
  });
}

describe("parseGeofabrikIndex", () => {
  it("keeps regions with a Geofabrik .pbf URL and a boundary, keyed by extract path", () => {
    const regions = parseGeofabrikIndex(FIXTURE);
    expect(regions.map((r) => r.path).sort()).toEqual([
      "europe",
      "europe/italy",
      "europe/italy/nord-est",
      "europe/italy/nord-ovest",
      "test/ring-region",
    ]);
    const italy = regions.find((r) => r.path === "europe/italy");
    // The bbox spans every part of a MultiPolygon.
    expect(italy?.bbox).toEqual([6.6, 36.6, 18.6, 47.1]);
    expect(italy?.areaKm2).toBeGreaterThan(100_000);
  });

  it("rejects a document without features", () => {
    expect(() => parseGeofabrikIndex("{}")).toThrow(/no features/);
  });
});

describe("GeofabrikIndex", () => {
  it("lists the extracts containing a bbox, smallest first", async () => {
    const regions = await index().findContaining(BERGAMO);
    expect(regions.map((r) => r.path)).toEqual([
      "europe/italy/nord-ovest",
      "europe/italy",
      "europe",
    ]);
    expect(regions[0]).toMatchObject({
      name: "Nord-Ovest",
      url: "https://download.geofabrik.de/europe/italy/nord-ovest-latest.osm.pbf",
    });
    expect(regions[0]).not.toHaveProperty("polygons");
  });

  it("excludes an extract the bbox only partly overlaps", async () => {
    // Straddles the nord-ovest / nord-est border at 10.5.
    const regions = await index().findContaining([10.4, 45.5, 10.6, 45.6]);
    expect(regions.map((r) => r.path)).toEqual(["europe/italy", "europe"]);
  });

  it("excludes a region whose boundary cuts into the bbox (sloped edge, hole)", async () => {
    const idx = index();
    // nord-ovest's north-west edge slopes from (6.6, 46.0) to (9.7, 46.6).
    const corner = await idx.findContaining([6.7, 46.0, 7.0, 46.1]);
    expect(corner.map((r) => r.path)).not.toContain("europe/italy/nord-ovest");
    // Inside the ring's outer boundary but over its hole.
    expect((await idx.findContaining([0.5, 0.5, 1.5, 1.5])).map((r) => r.path)).toEqual([]);
    expect((await idx.findContaining([0.2, 0.2, 0.8, 0.8])).map((r) => r.path)).toEqual([
      "test/ring-region",
    ]);
  });

  it("answers get() and covers() from the index (the build allowlist)", async () => {
    const idx = index();
    expect(await idx.get("europe/italy/nord-ovest")).toMatchObject({ name: "Nord-Ovest" });
    expect(await idx.get("europe/atlantis")).toBeNull();
    expect(await idx.get("foreign")).toBeNull();
    expect(await idx.covers("europe/italy/nord-ovest", BERGAMO)).toBe(true);
    expect(await idx.covers("europe/italy/nord-est", BERGAMO)).toBe(false);
  });

  it("fetches once with its User-Agent, caches on disk, and reuses the disk copy", async () => {
    const cacheDir = tmp();
    const fetch = okFetch();
    const first = index({ cacheDir, fetch });
    await first.findContaining(BERGAMO);
    await first.get("europe");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.headers?.["User-Agent"]).toBe("moveet-test");
    expect(fs.existsSync(path.join(cacheDir, "geofabrik-index.json"))).toBe(true);

    // A restart within the TTL reads the disk copy.
    const second = index({ cacheDir, fetch });
    await second.get("europe");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL", async () => {
    let now = 1_000_000;
    const fetch = okFetch();
    const idx = index({ fetch, now: () => now, ttlMs: 1000 });
    await idx.get("europe");
    now += 500;
    await idx.get("europe");
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 10_000;
    await idx.get("europe");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to a stale disk copy when the refresh fails", async () => {
    const cacheDir = tmp();
    fs.writeFileSync(path.join(cacheDir, "geofabrik-index.json"), FIXTURE);
    const old = new Date(Date.now() - 7 * 24 * 3600_000);
    fs.utimesSync(path.join(cacheDir, "geofabrik-index.json"), old, old);
    const fetch = vi.fn<FetchLike>(async () => ({ ok: false, status: 500, text: async () => "" }));
    const idx = index({ cacheDir, fetch });
    expect(await idx.get("europe/italy")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws GeofabrikUnavailableError with no copy at all", async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error("offline");
    });
    await expect(index({ fetch }).get("europe")).rejects.toBeInstanceOf(GeofabrikUnavailableError);
  });
});

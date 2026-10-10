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

  it("resolves parents to extract paths", () => {
    const regions = parseGeofabrikIndex(FIXTURE);
    const nordOvest = regions.find((r) => r.path === "europe/italy/nord-ovest");
    expect(nordOvest).toMatchObject({ parent: "europe/italy", depth: 2 });
    expect(regions.find((r) => r.path === "europe")).toMatchObject({ depth: 0 });
    expect(regions.find((r) => r.path === "europe")).not.toHaveProperty("parent");
  });

  it("picks the smallest containing extract, the common parent across a border", async () => {
    const idx = index();
    expect((await idx.smallestContaining(BERGAMO))?.path).toBe("europe/italy/nord-ovest");
    expect((await idx.smallestContaining([10.45, 45.5, 10.55, 45.55]))?.path).toBe("europe/italy");
    expect(await idx.smallestContaining([100, 10, 100.1, 10.1])).toBeNull();
  });

  it("looks up a bbox with download sizes and the borders it crosses", async () => {
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      if (init?.method === "HEAD") {
        const sizes: Record<string, string> = {
          "https://download.geofabrik.de/europe/italy-latest.osm.pbf": "2000000000",
        };
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: { get: (h: string) => (h === "content-length" ? (sizes[url] ?? null) : null) },
        };
      }
      return { ok: true, status: 200, text: async () => FIXTURE };
    });
    const idx = index({ fetch });

    const inside = await idx.lookup(BERGAMO);
    expect(inside.crosses).toBeUndefined();

    const across = await idx.lookup([10.45, 45.5, 10.55, 45.55]);
    expect(across.regions.map((r) => r.path)).toEqual(["europe/italy", "europe"]);
    expect(across.regions[0].sizeBytes).toBe(2_000_000_000);
    // Europe reported no size: left out rather than guessed.
    expect(across.regions[1]).not.toHaveProperty("sizeBytes");
    expect(across.crosses?.map((r) => r.path).sort()).toEqual([
      "europe/italy/nord-est",
      "europe/italy/nord-ovest",
    ]);

    // Sizes are cached: a second lookup sends no new HEAD for Italy.
    const heads = () =>
      fetch.mock.calls.filter(([u, i]) => i?.method === "HEAD" && u.includes("italy-latest"));
    expect(heads()).toHaveLength(1);
    await idx.lookup([10.45, 45.5, 10.55, 45.55]);
    expect(heads()).toHaveLength(1);
  });

  it("answers without a slow size, and has it on the next lookup", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      if (init?.method === "HEAD") {
        await slow;
        return {
          ok: true,
          status: 200,
          text: async () => "",
          headers: { get: (h: string) => (h === "content-length" ? "1234" : null) },
        };
      }
      return { ok: true, status: 200, text: async () => FIXTURE };
    });
    const idx = index({ fetch, sizeWaitMs: 10 });
    const first = await idx.lookup(BERGAMO);
    expect(first.regions[0]).not.toHaveProperty("sizeBytes");
    release();
    await new Promise((r) => setTimeout(r, 0));
    const second = await idx.lookup(BERGAMO);
    expect(second.regions[0].sizeBytes).toBe(1234);
    // One HEAD per extract, shared by both lookups.
    const heads = fetch.mock.calls.filter(([, i]) => i?.method === "HEAD");
    expect(heads).toHaveLength(3);
  });

  it("treats a failing size request as unknown", async () => {
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      if (init?.method === "HEAD") throw new Error("offline");
      return { ok: true, status: 200, text: async () => FIXTURE };
    });
    const { regions } = await index({ fetch }).lookup(BERGAMO);
    expect(regions[0].path).toBe("europe/italy/nord-ovest");
    expect(regions[0]).not.toHaveProperty("sizeBytes");
  });

  it("simplifies outlines by depth and caches them on disk for the loaded index", async () => {
    const cacheDir = tmp();
    const fetch = okFetch();
    const outlines = await index({ cacheDir, fetch }).outlines();
    expect(outlines.map((o) => o.path).sort()).toEqual([
      "europe",
      "europe/italy",
      "europe/italy/nord-est",
      "europe/italy/nord-ovest",
      "test/ring-region",
    ]);
    const ring = outlines.find((o) => o.path === "test/ring-region");
    expect(ring?.polygons[0]).toHaveLength(2); // outer ring and its hole
    const file = path.join(cacheDir, "geofabrik-outlines.json");
    expect(fs.existsSync(file)).toBe(true);

    // A restart reads the cached outlines instead of simplifying again.
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    cached.outlines[0].name = "From the disk cache";
    fs.writeFileSync(file, JSON.stringify(cached));
    const again = await index({ cacheDir, fetch }).outlines();
    expect(again[0].name).toBe("From the disk cache");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the outlines when a refresh brings a changed index", async () => {
    let now = 1_000_000;
    let body = FIXTURE;
    const fetch = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, text: async () => body }));
    const idx = index({ fetch, now: () => now, ttlMs: 1000 });
    const first = await idx.outlines();
    expect(await idx.outlines()).toBe(first);

    // Same content after the TTL: the outlines are reused.
    now += 10_000;
    expect(await idx.outlines()).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);

    body = FIXTURE.replace('"name": "Italy"', '"name": "Italia"');
    now += 10_000;
    const second = await idx.outlines();
    expect(second.find((o) => o.path === "europe/italy")?.name).toBe("Italia");
  });

  it("throws GeofabrikUnavailableError with no copy at all", async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error("offline");
    });
    await expect(index({ fetch }).get("europe")).rejects.toBeInstanceOf(GeofabrikUnavailableError);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeofabrikRegion, MapJob } from "@moveet/shared-types";
import type { Bbox } from "../../modules/maps/bbox";
import { MapLibrary } from "../../modules/maps/MapLibrary";
import {
  MapBuildError,
  MapBuildManager,
  OSM_ATTRIBUTION,
  type MapBuildManagerOptions,
} from "../../modules/maps/MapBuildManager";
import {
  MapBuildCancelledError,
  type BuildMapResult,
  type BuildProgress,
  type MapBuildChildRequest,
  type MapBuildRunner,
} from "../../modules/maps/MapBuildRunner";
import { GeofabrikUnavailableError } from "../../modules/maps/GeofabrikIndex";

const NETWORK = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { highway: "primary" },
      geometry: {
        type: "LineString",
        coordinates: [
          [9.65, 45.69],
          [9.66, 45.7],
        ],
      },
    },
  ],
};
const RESULT: BuildMapResult = {
  featureCount: 1,
  bbox: [9.65, 45.69, 9.66, 45.7],
  validation: {
    totalNodes: 2,
    totalEdges: 1,
    connectedComponents: 1,
    largestComponentPct: 100,
    isolatedNodes: 0,
    passed: true,
  },
  buildingCount: 3,
};
const BERGAMO = {
  label: "Bergamo centre",
  bbox: [9.64, 45.68, 9.7, 45.71] as [number, number, number, number],
  geofabrik: "europe/italy/nord-ovest",
  buildings: true,
  activate: false,
};

/** A runner whose builds the test settles by hand. */
class FakeRunner {
  calls: { request: MapBuildChildRequest; onProgress: (p: BuildProgress) => void }[] = [];
  private pending: {
    resolve: (r: BuildMapResult) => void;
    reject: (e: Error) => void;
    request: MapBuildChildRequest;
  }[] = [];
  cancels = 0;

  runner: MapBuildRunner = (request, onProgress) => {
    this.calls.push({ request, onProgress });
    let resolve!: (r: BuildMapResult) => void;
    let reject!: (e: Error) => void;
    const result = new Promise<BuildMapResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry = { resolve, reject, request };
    this.pending.push(entry);
    // Like the real pipeline: partial output exists while the build runs.
    fs.mkdirSync(request.outDir, { recursive: true });
    fs.mkdirSync(request.workDir, { recursive: true });
    fs.writeFileSync(path.join(request.workDir, "extract.osm.pbf"), "partial");
    return {
      result,
      cancel: () => {
        this.cancels++;
        reject(new MapBuildCancelledError());
      },
    };
  };

  /** Finishes the oldest build, writing its output like the pipeline would. */
  succeed(withBuildings = true): void {
    const entry = this.pending.shift();
    if (!entry) throw new Error("no build running");
    fs.writeFileSync(path.join(entry.request.outDir, "network.geojson"), JSON.stringify(NETWORK));
    if (withBuildings) {
      fs.mkdirSync(path.join(entry.request.outDir, "buildings"), { recursive: true });
      fs.writeFileSync(path.join(entry.request.outDir, "buildings", "index.json"), "{}");
    }
    entry.resolve(withBuildings ? RESULT : { ...RESULT, buildingCount: null });
  }

  fail(message: string): void {
    const entry = this.pending.shift();
    if (!entry) throw new Error("no build running");
    entry.reject(new Error(message));
  }
}

let root: string;
let library: MapLibrary;
let fake: FakeRunner;
let events: MapJob[];
let activate: ReturnType<typeof vi.fn<(id: string) => Promise<unknown>>>;
let geofabrik: {
  get: ReturnType<typeof vi.fn<(p: string) => Promise<GeofabrikRegion | null>>>;
  covers: ReturnType<typeof vi.fn<(p: string, b: Bbox) => Promise<boolean>>>;
  smallestContaining: ReturnType<typeof vi.fn<(b: Bbox) => Promise<GeofabrikRegion | null>>>;
};

function manager(overrides: Partial<MapBuildManagerOptions> = {}): MapBuildManager {
  const m = new MapBuildManager({
    library,
    geofabrik,
    presets: {
      bergamo: {
        label: "Bergamo",
        bbox: [9.64, 45.68, 9.7, 45.71],
        geofabrik: "europe/italy/nord-ovest",
      },
      huge: { label: "Huge", bbox: [0, 40, 5, 45], geofabrik: "europe/france" },
    },
    runner: fake.runner,
    cacheDir: path.join(root, ".cache"),
    allowed: true,
    maxAreaKm2: 2500,
    diskQuotaBytes: 100 * 1024 * 1024,
    maxQueued: 1,
    activate,
    newId: (() => {
      let n = 0;
      return () => `job-${++n}`;
    })(),
    ...overrides,
  });
  m.on("mapjob", (job) => events.push(job));
  return m;
}

/** Lets the manager's promise chains run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function settle(m: MapBuildManager, id: string): Promise<MapJob> {
  for (let i = 0; i < 50; i++) {
    const job = m.get(id);
    if (job && !["queued", "running"].includes(job.status)) return job;
    await flush();
  }
  throw new Error(`job ${id} did not settle`);
}

function hiddenEntries(): string[] {
  return fs.readdirSync(root).filter((e) => e.startsWith(".build-"));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-mapbuild-"));
  library = new MapLibrary(root);
  fs.mkdirSync(root, { recursive: true });
  fake = new FakeRunner();
  events = [];
  activate = vi.fn<(id: string) => Promise<unknown>>(async () => ({}));
  geofabrik = {
    get: vi.fn(async (p: string) =>
      p === "europe/italy/nord-ovest"
        ? {
            path: p,
            name: "Nord-Ovest",
            bbox: [6.6, 43.7, 10.5, 46.6] as Bbox,
            areaKm2: 1,
            url: "",
          }
        : null
    ),
    covers: vi.fn(async (_p: string, _b: Bbox) => true),
    smallestContaining: vi.fn(async (_b: Bbox) => ({
      path: "europe/italy",
      name: "Italy",
      bbox: [6.6, 36.6, 18.6, 47.1] as Bbox,
      areaKm2: 1,
      url: "",
    })),
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MapBuildManager: lifecycle", () => {
  it("runs queued -> running -> done and adds the map with its meta", async () => {
    const m = manager();
    const job = await m.submit(BERGAMO);
    // Nothing else is running, so the job starts straight away.
    expect(job.status).toBe("running");
    expect(fake.calls[0].request).toMatchObject({
      geofabrik: "europe/italy/nord-ovest",
      bbox: BERGAMO.bbox,
      cacheDir: path.join(root, ".cache"),
      buildings: true,
    });
    // Output is staged inside the library root (same filesystem, hidden name).
    expect(path.dirname(fake.calls[0].request.outDir)).toBe(library.root);

    fake.calls[0].onProgress({
      step: "download",
      progress: 0.2,
      bytesDownloaded: 10,
      totalBytes: 50,
    });
    expect(m.get(job.id)).toMatchObject({
      step: "download",
      progress: 0.2,
      bytesDownloaded: 10,
      totalBytes: 50,
    });

    fake.succeed();
    const done = await settle(m, job.id);
    expect(done).toMatchObject({ status: "done", progress: 1, mapId: "bergamo-centre" });
    expect(done.error).toBeUndefined();
    expect(done.finishedAt).toBeDefined();

    const meta = library.get("bergamo-centre");
    expect(meta).toMatchObject({
      label: "Bergamo centre",
      source: { type: "geofabrik", path: "europe/italy/nord-ovest", bbox: BERGAMO.bbox },
      bbox: RESULT.bbox,
      featureCount: 1,
      buildingCount: 3,
      hasBuildings: true,
      attribution: OSM_ATTRIBUTION,
    });
    expect(meta?.sizes.networkBytes).toBeGreaterThan(0);
    expect(hiddenEntries()).toEqual([]);
    expect(fs.existsSync(fake.calls[0].request.workDir)).toBe(false);
    expect(activate).not.toHaveBeenCalled();

    expect(events.map((e) => e.status)).toEqual(
      expect.arrayContaining(["queued", "running", "done"])
    );
    expect(events.at(-1)).toMatchObject({ status: "done", mapId: "bergamo-centre" });
  });

  it("builds a preset, with a preset source and a unique id", async () => {
    const m = manager();
    library.importMap({
      id: "bergamo",
      label: "Existing",
      networkPath: writeNetwork(),
      source: { type: "bundled" },
    });
    const job = await m.submit({ preset: "bergamo", buildings: false, activate: false });
    expect(fake.calls[0].request.buildings).toBe(false);
    fake.succeed(false);
    const done = await settle(m, job.id);
    expect(done.mapId).toBe("bergamo-2");
    expect(library.get("bergamo-2")).toMatchObject({
      label: "Bergamo",
      source: { type: "preset", name: "bergamo", path: "europe/italy/nord-ovest" },
      hasBuildings: false,
    });
    expect(library.get("bergamo-2")?.buildingCount).toBeUndefined();
  });

  it("activates the built map when asked", async () => {
    const m = manager();
    const job = await m.submit({ ...BERGAMO, activate: true });
    fake.succeed();
    const done = await settle(m, job.id);
    expect(activate).toHaveBeenCalledWith("bergamo-centre");
    expect(done.status).toBe("done");
    expect(events.some((e) => e.step === "activate")).toBe(true);
  });

  it("still finishes done, with an error, when activation fails", async () => {
    activate.mockRejectedValueOnce(new Error("switch in progress"));
    const m = manager();
    const job = await m.submit({ ...BERGAMO, activate: true });
    fake.succeed();
    const done = await settle(m, job.id);
    expect(done.status).toBe("done");
    expect(done.mapId).toBe("bergamo-centre");
    expect(done.error).toMatch(/could not activate.*switch in progress/);
  });

  it("marks a failed build failed and removes its partial output", async () => {
    const m = manager();
    const job = await m.submit(BERGAMO);
    const { outDir, workDir } = fake.calls[0].request;
    expect(fs.existsSync(outDir)).toBe(true);
    fake.fail("osmium exploded");
    const failed = await settle(m, job.id);
    expect(failed).toMatchObject({ status: "failed", error: "osmium exploded" });
    expect(fs.existsSync(outDir)).toBe(false);
    expect(fs.existsSync(workDir)).toBe(false);
    expect(library.list()).toEqual([]);
  });

  it("cancels a running build: kills it, cleans up, reports cancelled", async () => {
    const m = manager();
    const job = await m.submit(BERGAMO);
    const { outDir, workDir } = fake.calls[0].request;
    const res = m.cancel(job.id);
    expect(res.status).toBe("running");
    expect(fake.cancels).toBe(1);
    const cancelled = await settle(m, job.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBeUndefined();
    expect(fs.existsSync(outDir)).toBe(false);
    expect(fs.existsSync(workDir)).toBe(false);
    expect(library.list()).toEqual([]);
    expect(events.at(-1)?.status).toBe("cancelled");
  });

  it("runs one build at a time, starts the next when one ends, and cancels queued ones", async () => {
    const m = manager({ maxQueued: 2 });
    const first = await m.submit(BERGAMO);
    const second = await m.submit({ ...BERGAMO, label: "Second" });
    const third = await m.submit({ ...BERGAMO, label: "Third" });
    expect(fake.calls).toHaveLength(1);
    expect(m.get(second.id)?.status).toBe("queued");

    expect(m.cancel(third.id).status).toBe("cancelled");
    fake.succeed();
    await settle(m, first.id);
    await flush();
    expect(fake.calls).toHaveLength(2);
    expect(m.get(second.id)?.status).toBe("running");
    fake.succeed();
    await settle(m, second.id);
    expect(fake.calls).toHaveLength(2);
    expect(m.list().map((j) => j.id)).toEqual([third.id, second.id, first.id]);
  });

  it("refuses with 409 when the queue is full", async () => {
    const m = manager({ maxQueued: 1 });
    await m.submit(BERGAMO);
    await m.submit({ ...BERGAMO, label: "Queued" });
    await expect(m.submit({ ...BERGAMO, label: "Too many" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses to cancel an unknown (404) or finished (409) job", async () => {
    const m = manager();
    expect(() => m.cancel("nope")).toThrow(expect.objectContaining({ status: 404 }));
    const job = await m.submit(BERGAMO);
    fake.succeed();
    await settle(m, job.id);
    expect(() => m.cancel(job.id)).toThrow(expect.objectContaining({ status: 409 }));
  });

  it("removes staging and scratch directories left by a previous process", () => {
    fs.mkdirSync(path.join(root, ".build-old"), { recursive: true });
    fs.mkdirSync(path.join(root, ".cache", "jobs", "old"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cache", "x-latest.osm.pbf.part"), "half");
    fs.writeFileSync(path.join(root, ".cache", "y-latest.osm.pbf"), "whole");
    manager();
    expect(hiddenEntries()).toEqual([]);
    expect(fs.existsSync(path.join(root, ".cache", "jobs"))).toBe(false);
    expect(fs.readdirSync(path.join(root, ".cache"))).toEqual(["y-latest.osm.pbf"]);
  });

  it("kills a running build on shutdown", async () => {
    const m = manager();
    const job = await m.submit(BERGAMO);
    m.shutdown();
    expect((await settle(m, job.id)).status).toBe("cancelled");
  });
});

describe("MapBuildManager: guards", () => {
  it("refuses everything with 403 when builds are disabled", async () => {
    const m = manager({ allowed: false });
    expect(m.allowed).toBe(false);
    await expect(m.submit(BERGAMO)).rejects.toMatchObject({ status: 403 });
    expect(() => m.cancel("job-1")).toThrow(expect.objectContaining({ status: 403 }));
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects an extract missing from the Geofabrik index (allowlist)", async () => {
    const m = manager();
    await expect(m.submit({ ...BERGAMO, geofabrik: "europe/atlantis" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Not a Geofabrik extract/),
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a bbox outside the named extract with 422, naming one that holds it", async () => {
    const m = manager();
    geofabrik.covers.mockResolvedValueOnce(false);
    await expect(m.submit(BERGAMO)).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/smallest extract that contains it is europe\/italy/),
    });
  });

  it("cuts an unnamed custom area from the smallest containing extract, bbox untouched", async () => {
    const m = manager();
    const { geofabrik: _named, ...unnamed } = BERGAMO;
    const job = await m.submit(unnamed);
    expect(job).toMatchObject({ bbox: BERGAMO.bbox, geofabrik: "europe/italy" });
    expect(geofabrik.smallestContaining).toHaveBeenCalledWith(BERGAMO.bbox);
  });

  it("answers 422 for an unnamed area no extract holds", async () => {
    const m = manager();
    geofabrik.smallestContaining.mockResolvedValueOnce(null);
    const { geofabrik: _named, ...unnamed } = BERGAMO;
    await expect(m.submit(unnamed)).rejects.toMatchObject({ status: 422 });
    expect(fake.calls).toHaveLength(0);
  });

  it("answers 503 when the Geofabrik index is unavailable", async () => {
    geofabrik.get.mockRejectedValueOnce(new GeofabrikUnavailableError("offline"));
    await expect(manager().submit(BERGAMO)).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    [[9.7, 45.68, 9.64, 45.71], /west must be less than east/],
    [[9.64, 45.71, 9.7, 45.68], /south must be less than north/],
    [[9.64, 45.68, Number.NaN, 45.71], /finite/],
    [[9, 45, 10, 46], /over the 2500 km² limit/],
  ])("rejects bbox %j", async (bbox, message) => {
    await expect(
      manager().submit({ ...BERGAMO, bbox: bbox as [number, number, number, number] })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
  });

  it("applies the area cap to presets and rejects unknown ones", async () => {
    const m = manager();
    await expect(
      m.submit({ preset: "huge", buildings: true, activate: false })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/limit/) });
    await expect(
      m.submit({ preset: "toString", buildings: true, activate: false })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Unknown preset/) });
  });

  it("refuses with 507 once the maps use the disk quota", async () => {
    library.importMap({
      id: "big",
      label: "Big",
      networkPath: writeNetwork(),
      source: { type: "bundled" },
    });
    const m = manager({ diskQuotaBytes: 10 });
    await expect(m.submit(BERGAMO)).rejects.toMatchObject({
      status: 507,
      message: expect.stringMatching(/quota/),
    });
    expect(m.limits()).toMatchObject({ diskQuotaBytes: 10, maxAreaKm2: 2500, maxQueuedJobs: 1 });
    expect(m.limits().diskUsedBytes).toBeGreaterThan(10);
  });

  it("does not count the download cache against the quota", async () => {
    fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cache", "x-latest.osm.pbf"), Buffer.alloc(4096));
    const m = manager({ diskQuotaBytes: 100 });
    expect(m.limits()).toMatchObject({ diskUsedBytes: 0, cacheBytes: 4096 });
    await expect(m.submit(BERGAMO)).resolves.toMatchObject({ status: "running" });
  });

  it("is a MapBuildError carrying the HTTP status", () => {
    const err = new MapBuildError(418, "teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(418);
  });
});

function writeNetwork(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moveet-net-")), "n.geojson");
  fs.writeFileSync(file, JSON.stringify(NETWORK));
  return file;
}

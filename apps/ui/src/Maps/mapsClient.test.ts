import { beforeEach, describe, expect, it } from "vitest";
import type { MapJob } from "@moveet/shared-types";
import { LIMITS, libraryBody, makeMap, mockMapsServer } from "@/test/mocks/mapsServer";
import {
  activateMap,
  buildMap,
  cancelMapJob,
  deleteMap,
  findGeofabrik,
  geocode,
  listMapJobs,
  listMaps,
  listPresets,
  parseGeocode,
  parseGeofabrik,
  parseGeofabrikLookup,
  parseGeofabrikOutlines,
  parseMapJob,
  parseMapJobs,
  parseMapList,
  parsePresets,
} from "./mapsClient";

const JOB: MapJob = {
  id: "job-1",
  status: "running",
  step: "download",
  progress: 0.25,
  bytesDownloaded: 1024,
  totalBytes: 4096,
  label: "Lisbon",
  bbox: [-9.2, 38.7, -9.1, 38.8],
  geofabrik: "europe/portugal",
  buildings: true,
  activate: false,
  createdAt: "2026-10-10T10:00:00Z",
};

const PRESET = {
  name: "lisbon",
  label: "Lisbon",
  bbox: [-9.2, 38.7, -9.1, 38.8],
  geofabrik: "europe/portugal",
  areaKm2: 96,
};

describe("parseMapList", () => {
  it("reads the library and the build capabilities", () => {
    const lib = parseMapList(libraryBody([makeMap()], "nairobi"));
    expect(lib?.activeId).toBe("nairobi");
    expect(lib?.maps).toHaveLength(1);
    expect(lib?.builds).toEqual({ allowed: true, limits: LIMITS });
  });

  it("reports no build support when the server has no buildsAllowed field", () => {
    const lib = parseMapList({ maps: [makeMap()], activeId: "nairobi", switching: true });
    expect(lib?.builds).toBeNull();
    expect(lib?.switching).toBe(true);
  });

  it("rejects a body that is not a library and drops malformed maps", () => {
    expect(parseMapList([])).toBeNull();
    expect(parseMapList({ maps: "nope" })).toBeNull();
    const lib = parseMapList({ maps: [makeMap(), { id: 3 }, null], activeId: "nairobi" });
    expect(lib?.maps.map((m) => m.id)).toEqual(["nairobi"]);
  });
});

describe("job parsing", () => {
  it("passes a job through, clamping its progress", () => {
    expect(parseMapJob({ ...JOB, progress: 3 })).toEqual({ ...JOB, progress: 1 });
  });

  it("rejects what is not a job", () => {
    expect(parseMapJob({ ...JOB, status: "exploded" })).toBeNull();
    expect(parseMapJob({ status: "queued" })).toBeNull();
    expect(parseMapJob("nope")).toBeNull();
  });

  it("reads the job list envelope", () => {
    expect(parseMapJobs({ jobs: [JOB, { id: 1 }] })).toEqual([JOB]);
    expect(parseMapJobs([JOB])).toBeNull();
  });
});

describe("lookup parsing", () => {
  it("reads presets, skipping broken ones", () => {
    expect(parsePresets({ presets: [PRESET, { name: "x" }] })).toEqual([PRESET]);
    expect(parsePresets([PRESET])).toBeNull();
  });

  it("reads Geofabrik regions", () => {
    const region = {
      path: "europe/portugal",
      name: "Portugal",
      bbox: [-10, 36, -6, 42],
      areaKm2: 92000,
      url: "https://download.geofabrik.de/europe/portugal-latest.osm.pbf",
    };
    expect(parseGeofabrik({ regions: [region, { name: "no path" }] })).toEqual([region]);
  });

  it("reads a lookup with the borders a box crosses, ignoring a single crossing", () => {
    const region = { path: "europe/italy", name: "Italy", bbox: [6, 36, 19, 47], areaKm2: 1 };
    const crosses = [
      { path: "europe/italy/nord-ovest", name: "Nord-Ovest" },
      { path: "europe/italy/nord-est", name: "Nord-Est" },
    ];
    expect(parseGeofabrikLookup({ regions: [region], crosses })).toEqual({
      regions: [region],
      crosses,
    });
    expect(parseGeofabrikLookup({ regions: [region], crosses: [crosses[0]] })).toEqual({
      regions: [region],
    });
    expect(parseGeofabrikLookup({ nope: true })).toBeNull();
  });

  it("keeps only drawable Geofabrik outlines", () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const good = { path: "europe", name: "Europe", depth: 0, polygons: [[ring]] };
    const parsed = parseGeofabrikOutlines({
      regions: [good, { path: "x", name: "X", depth: 0, polygons: [[[[0, 0]]]] }, { path: 1 }],
      attribution: "Geofabrik",
    });
    expect(parsed).toEqual({ regions: [good], attribution: "Geofabrik" });
    expect(parseGeofabrikOutlines(null)).toBeNull();
  });

  it("reads geocoder results and the attribution", () => {
    const result = {
      name: "Lisbon, Portugal",
      bbox: [-9.2, 38.7, -9.1, 38.8],
      center: [-9.14, 38.72],
      type: "place/city",
    };
    expect(
      parseGeocode({ results: [result, { name: "no box" }], attribution: "© OpenStreetMap" })
    ).toEqual({ results: [result], attribution: "© OpenStreetMap" });
  });
});

describe("transport", () => {
  beforeEach(() => {
    mockMapsServer({});
  });

  it("lists the library", async () => {
    mockMapsServer({ "GET /maps": { body: libraryBody([makeMap()], "nairobi") } });
    const res = await listMaps();
    expect(res.ok && res.data.maps[0].id).toBe("nairobi");
  });

  it("returns the HTTP status and the server's error message", async () => {
    mockMapsServer({
      "POST /maps/lisbon/activate": { status: 409, body: { error: "A map switch is in progress" } },
    });
    const res = await activateMap("lisbon");
    expect(res).toEqual({ ok: false, status: 409, error: "A map switch is in progress" });
  });

  it("reports 404 for a build endpoint the server does not have", async () => {
    const res = await listPresets();
    expect(!res.ok && res.status).toBe(404);
  });

  it("treats a 204 delete as success", async () => {
    const { calls } = mockMapsServer({ "DELETE /maps/old": { status: 204 } });
    expect((await deleteMap("old")).ok).toBe(true);
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/maps/old" });
  });

  it("posts a build request and reads the job back", async () => {
    const { calls } = mockMapsServer({ "POST /maps": { status: 202, body: JOB } });
    const res = await buildMap({ preset: "lisbon", buildings: false, activate: true });
    expect(res.ok && res.data).toEqual(JOB);
    expect(calls[0].body).toEqual({ preset: "lisbon", buildings: false, activate: true });
  });

  it("surfaces a refused build with its status", async () => {
    mockMapsServer({
      "POST /maps": { status: 507, body: { error: "The map library is over its disk quota" } },
    });
    const res = await buildMap({ preset: "lisbon" });
    expect(res).toEqual({
      ok: false,
      status: 507,
      error: "The map library is over its disk quota",
    });
  });

  it("lists and cancels jobs", async () => {
    const { calls } = mockMapsServer({
      "GET /maps/jobs": { body: { jobs: [JOB] } },
      "DELETE /maps/jobs/job-1": { status: 202, body: { ...JOB, status: "cancelled" } },
    });
    const list = await listMapJobs();
    expect(list.ok && list.data.map((j) => j.id)).toEqual(["job-1"]);
    expect((await cancelMapJob("job-1")).ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /maps/jobs",
      "DELETE /maps/jobs/job-1",
    ]);
  });

  it("sends the bbox to the Geofabrik lookup and the query to the geocoder", async () => {
    const { calls } = mockMapsServer({
      "GET /maps/geofabrik": { body: { regions: [{ path: "europe/portugal", name: "Portugal" }] } },
      "GET /maps/geocode": { status: 429, body: { error: "Slow down" } },
    });
    const regions = await findGeofabrik([-9.2, 38.7, -9.1, 38.8]);
    expect(regions.ok && regions.data.regions.map((r) => r.path)).toEqual(["europe/portugal"]);
    const places = await geocode("são paulo");
    expect(!places.ok && places.status).toBe(429);
    expect(calls[0].path).toBe("/maps/geofabrik?bbox=-9.2,38.7,-9.1,38.8");
    expect(calls[1].path).toBe("/maps/geocode?q=s%C3%A3o%20paulo");
  });

  it("never throws: a network failure is status 0", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await listMaps()).toEqual({ ok: false, status: 0, error: "offline" });
  });

  it("flags a body it cannot read", async () => {
    mockMapsServer({ "GET /maps": { body: { nope: true } } });
    const res = await listMaps();
    expect(!res.ok && res.error).toMatch(/unexpected body/);
  });
});

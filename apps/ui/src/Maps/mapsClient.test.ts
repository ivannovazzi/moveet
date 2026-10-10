import { beforeEach, describe, expect, it } from "vitest";
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
  parseBuildAccepted,
  parseGeocode,
  parseMapJob,
  parseMapJobMessage,
  parseMapList,
  parsePresets,
} from "./mapsClient";

const JOB = {
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

describe("parseMapList", () => {
  it("reads the library and the build capabilities", () => {
    const lib = parseMapList(libraryBody([makeMap()], "nairobi"));
    expect(lib?.activeId).toBe("nairobi");
    expect(lib?.maps).toHaveLength(1);
    expect(lib?.builds).toEqual({
      allowed: true,
      limits: {
        maxAreaKm2: LIMITS.maxAreaKm2,
        diskQuotaBytes: LIMITS.diskQuotaBytes,
        diskUsedBytes: LIMITS.diskUsedBytes,
      },
    });
  });

  it("reports no build support when the server has no buildsAllowed field", () => {
    const lib = parseMapList({ maps: [makeMap()], activeId: "nairobi", switching: true });
    expect(lib?.builds).toBeNull();
    expect(lib?.switching).toBe(true);
  });

  it("accepts limits at the top level or under another key", () => {
    const flat = parseMapList({ maps: [], activeId: "", buildsAllowed: false, maxAreaKm2: 10 });
    expect(flat?.builds).toEqual({
      allowed: false,
      limits: { maxAreaKm2: 10, diskQuotaBytes: null, diskUsedBytes: null },
    });
    const caps = parseMapList({
      maps: [],
      activeId: "",
      buildsAllowed: true,
      caps: { maxBboxAreaKm2: 5 },
    });
    expect(caps?.builds?.limits.maxAreaKm2).toBe(5);
  });

  it("rejects a body that is not a library and drops malformed maps", () => {
    expect(parseMapList([])).toBeNull();
    expect(parseMapList({ maps: "nope" })).toBeNull();
    const lib = parseMapList({ maps: [makeMap(), { id: 3 }, null], activeId: "nairobi" });
    expect(lib?.maps.map((m) => m.id)).toEqual(["nairobi"]);
  });
});

describe("job parsing", () => {
  it("normalizes a job and clamps its progress", () => {
    expect(parseMapJob({ ...JOB, progress: 3 })).toMatchObject({
      id: "job-1",
      status: "running",
      step: "download",
      progress: 1,
      bytesDownloaded: 1024,
      totalBytes: 4096,
      label: "Lisbon",
      activate: false,
    });
  });

  it("falls back to the status for a missing step and rejects unknown statuses", () => {
    expect(parseMapJob({ id: "a", status: "queued" })?.step).toBe("queued");
    expect(parseMapJob({ id: "a", status: "exploded" })).toBeNull();
    expect(parseMapJob({ status: "queued" })).toBeNull();
  });

  it("reads a WebSocket frame, bare or wrapped", () => {
    expect(parseMapJobMessage(JOB)?.id).toBe("job-1");
    expect(parseMapJobMessage({ job: JOB })?.id).toBe("job-1");
    expect(parseMapJobMessage({ hello: 1 })).toBeNull();
    expect(parseMapJobMessage("nope")).toBeNull();
  });

  it("takes a build acceptance as a full job, a bare id, or a jobId", () => {
    expect(parseBuildAccepted(JOB)).toMatchObject({ id: "job-1", job: { status: "running" } });
    expect(parseBuildAccepted({ id: "job-2" })).toEqual({ id: "job-2" });
    expect(parseBuildAccepted({ jobId: "job-3" })).toEqual({ id: "job-3" });
    expect(parseBuildAccepted({})).toBeNull();
  });
});

describe("lookup parsing", () => {
  it("reads presets from an envelope or a bare array, skipping broken ones", () => {
    const preset = { name: "lisbon", label: "Lisbon", bbox: [-9.2, 38.7, -9.1, 38.8], areaKm2: 96 };
    expect(parsePresets({ presets: [preset, { name: "x" }] })).toEqual([
      { ...preset, geofabrik: undefined },
    ]);
    expect(parsePresets([preset])).toHaveLength(1);
  });

  it("reads geocoder candidates and coerces string coordinates", () => {
    const res = parseGeocode({
      results: [{ name: "Lisbon, Portugal", bbox: ["-9.2", "38.7", "-9.1", "38.8"], type: "city" }],
      attribution: "Data © OpenStreetMap contributors",
    });
    expect(res.candidates).toEqual([
      { name: "Lisbon, Portugal", bbox: [-9.2, 38.7, -9.1, 38.8], type: "city" },
    ]);
    expect(res.attribution).toMatch(/OpenStreetMap/);
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
    expect(res.ok).toBe(false);
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
    expect(res.ok && res.data.id).toBe("job-1");
    expect(calls[0].body).toEqual({ preset: "lisbon", buildings: false, activate: true });
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
      "GET /maps/geofabrik": {
        body: { regions: [{ path: "europe/portugal", name: "Portugal", size: 300 }] },
      },
      "GET /maps/geocode": { status: 429, body: { error: "Slow down" } },
    });
    const regions = await findGeofabrik([-9.2, 38.7, -9.1, 38.8]);
    expect(regions.ok && regions.data).toEqual([
      { path: "europe/portugal", name: "Portugal", sizeBytes: 300 },
    ]);
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

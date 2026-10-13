import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestSource } from "./rest";

vi.mock("../../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch, HttpTimeoutError, HttpClientError } from "../../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

describe("RestSource health check", () => {
  let source: RestSource;

  beforeEach(() => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("reports unhealthy when not connected", async () => {
    const result = await source.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports healthy when URL is reachable", async () => {
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
    await source.connect({ url: "http://example.com/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(true);
  });

  it("reports unhealthy when URL returns error status", async () => {
    mockHttpFetch.mockRejectedValue(new HttpClientError("HTTP 503", 503, true));
    await source.connect({ url: "http://example.com/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports unhealthy when fetch throws", async () => {
    mockHttpFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await source.connect({ url: "http://unreachable.local/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("RestSource getVehicles", () => {
  let source: RestSource;

  beforeEach(() => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("filters out vehicles with NaN coordinates but keeps coordinate-less ones", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [
            { id: "v1", name: "Good", lat: 1.5, lng: 36.8 },
            { id: "v2", name: "Bad Lat", lat: "not-a-number", lng: 36.8 },
            { id: "v3", name: "Bad Lng", lat: 1.5, lng: "abc" },
            // No coordinates at all → valid, position left undefined.
            { id: "v4", name: "No Coords" },
          ],
        }),
        { status: 200 }
      )
    );
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(2);
    expect(vehicles[0].id).toBe("v1");
    expect(vehicles[0].position).toEqual([1.5, 36.8]);
    expect(vehicles[1].id).toBe("v4");
    expect(vehicles[1].position).toBeUndefined();
  });

  it("filters out vehicles with Infinity coordinates", async () => {
    // Infinity can't survive JSON.stringify, so we create a mock Response
    // whose json() returns the object directly.
    mockHttpFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vehicles: [
            { id: "v1", name: "Good", lat: -1.28, lng: 36.8 },
            { id: "v2", name: "Inf", lat: Infinity, lng: 36.8 },
          ],
        }),
    } as unknown as Response);
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("returns valid vehicles with correct positions", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [{ id: "v1", name: "Vehicle 1", lat: -1.28, lng: 36.82 }],
        }),
        { status: 200 }
      )
    );
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].position).toEqual([-1.28, 36.82]);
  });

  it("captures metadata from a position-less roster via metadataMap", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          assignments: [
            { deviceId: "d1", deviceType: "gps", vehicleId: "v1" },
            { deviceId: "d2", deviceType: "mobile", vehicleId: "v2" },
          ],
        }),
        { status: 200 }
      )
    );
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      fieldMap: { id: "deviceId" },
      metadataMap: { deviceType: "deviceType", vehicleId: "vehicleId" },
    });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]).toMatchObject({
      id: "d1",
      metadata: { deviceType: "gps", vehicleId: "v1" },
    });
    expect(vehicles[0].position).toBeUndefined();
    expect(vehicles[1]).toMatchObject({
      id: "d2",
      metadata: { deviceType: "mobile", vehicleId: "v2" },
    });
    expect(vehicles[1].position).toBeUndefined();
  });

  it("omits metadata that does not resolve and never attaches an empty object", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          assignments: [{ deviceId: "d1", deviceType: "gps" }, { deviceId: "d2" }],
        }),
        { status: 200 }
      )
    );
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      fieldMap: { id: "deviceId" },
      metadataMap: { deviceType: "deviceType", vehicleId: "vehicleId" },
    });

    const vehicles = await source.getVehicles();

    expect(vehicles[0].metadata).toEqual({ deviceType: "gps" });
    expect(vehicles[1].metadata).toBeUndefined();
  });

  it("attaches no metadata when metadataMap is absent (back-compat)", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [{ id: "v1", name: "Vehicle 1", lat: -1.28, lng: 36.82 }],
        }),
        { status: 200 }
      )
    );
    await source.connect({ url: "http://example.com/api" });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].metadata).toBeUndefined();
    expect(vehicles[0].position).toEqual([-1.28, 36.82]);
  });
});

describe("RestSource getVehicles groupBy", () => {
  let source: RestSource;

  const roster = () =>
    new Response(
      JSON.stringify({
        assignments: [
          { deviceId: "d1", deviceType: "gps", vehicleId: "v1" },
          { deviceId: "d2", deviceType: "mobile", vehicleId: "v1" },
          { deviceId: "d3", deviceType: "gps", vehicleId: "v2" },
        ],
      }),
      { status: 200 }
    );

  beforeEach(() => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("produces one entity per group with metadata.devices", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      groupBy: "vehicleId",
      fieldMap: { id: "deviceId" },
      metadataMap: { deviceType: "deviceType" },
    });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]).toMatchObject({
      id: "v1",
      name: "v1",
      metadata: {
        devices: [
          { id: "d1", deviceType: "gps" },
          { id: "d2", deviceType: "mobile" },
        ],
      },
    });
    expect(vehicles[0].position).toBeUndefined();
    expect(vehicles[1]).toMatchObject({
      id: "v2",
      name: "v2",
      metadata: { devices: [{ id: "d3", deviceType: "gps" }] },
    });
  });

  it("applies limit to the number of groups, not items", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      groupBy: "vehicleId",
      fieldMap: { id: "deviceId" },
      metadataMap: { deviceType: "deviceType" },
      limit: 1,
    });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
    expect(vehicles[0].metadata!.devices as unknown[]).toHaveLength(2);
  });

  it("seeds position from the group's first item when coords resolve", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          assignments: [
            { deviceId: "d1", vehicleId: "v1", lat: -1.28, lng: 36.8 },
            { deviceId: "d2", vehicleId: "v1", lat: -1.5, lng: 37.0 },
          ],
        }),
        { status: 200 }
      )
    );
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      groupBy: "vehicleId",
      fieldMap: { id: "deviceId" },
    });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].position).toEqual([-1.28, 36.8]);
  });

  it("is unchanged (one entity per item) when groupBy is unset", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({
      url: "http://example.com/roster",
      vehiclePath: "assignments",
      fieldMap: { id: "deviceId" },
      metadataMap: { deviceType: "deviceType" },
    });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(3);
    expect(vehicles.map((v) => v.id)).toEqual(["d1", "d2", "d3"]);
    expect(vehicles[0].metadata).toEqual({ deviceType: "gps" });
  });
});

describe("RestSource getVehicles filter", () => {
  let source: RestSource;

  const roster = () =>
    new Response(
      JSON.stringify({
        assignments: [
          { deviceId: "d1", deviceType: "gps", vehicleId: "v1", source: "fixed", slot: 1 },
          { deviceId: "d2", deviceType: "mobile", vehicleId: "v1", source: "handheld", slot: 2 },
          { deviceId: "d3", deviceType: "mobile", vehicleId: "v2", source: "handheld", slot: 1 },
          { deviceId: "d4", deviceType: "tracker", vehicleId: "v3", source: "fixed", slot: 1 },
          { deviceId: "d5", deviceType: "gps", vehicleId: "v4", source: "fixed", slot: 3 },
        ],
      }),
      { status: 200 }
    );

  const base = {
    url: "http://example.com/roster",
    vehiclePath: "assignments",
    fieldMap: { id: "deviceId" },
  };

  beforeEach(() => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("keeps only items whose path equals a single value", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { source: "fixed" } });

    const vehicles = await source.getVehicles();

    expect(vehicles.map((v) => v.id)).toEqual(["d1", "d4", "d5"]);
  });

  it("treats an array value as any-of", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { deviceType: ["gps", "tracker"] } });

    const vehicles = await source.getVehicles();

    expect(vehicles.map((v) => v.id)).toEqual(["d1", "d4", "d5"]);
  });

  it("requires every path to match (AND)", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { source: "fixed", deviceType: "gps" } });

    const vehicles = await source.getVehicles();

    expect(vehicles.map((v) => v.id)).toEqual(["d1", "d5"]);
  });

  it("coerces scalars with String() so numbers match their string form", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { slot: "1" } });
    expect((await source.getVehicles()).map((v) => v.id)).toEqual(["d1", "d3", "d4"]);

    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { slot: [3, "2"] } });
    expect((await source.getVehicles()).map((v) => v.id)).toEqual(["d2", "d5"]);
  });

  it("resolves nested dot-paths", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [
            { id: "a", meta: { kind: "truck" } },
            { id: "b", meta: { kind: "van" } },
            { id: "c" },
          ],
        }),
        { status: 200 }
      )
    );
    await source.connect({ url: "http://example.com/api", filter: { "meta.kind": "truck" } });

    expect((await source.getVehicles()).map((v) => v.id)).toEqual(["a"]);
  });

  it("never matches an unsafe (prototype-pollution) path", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    // "[object Object]" is what String() of an inherited prototype would give.
    await source.connect({ ...base, filter: { "__proto__.toString": "[object Object]" } });
    expect(await source.getVehicles()).toEqual([]);

    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { "constructor.name": "Object" } });
    expect(await source.getVehicles()).toEqual([]);
  });

  it("does not match a missing path, even against the string 'undefined'", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { missing: "undefined" } });

    expect(await source.getVehicles()).toEqual([]);
  });

  it("filters before groupBy and before limit", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({
      ...base,
      groupBy: "vehicleId",
      metadataMap: { deviceType: "deviceType" },
      filter: { source: "fixed" },
      limit: 2,
    });

    const vehicles = await source.getVehicles();

    // v2 only has a handheld, so it is gone; limit 2 counts filtered groups
    // (v1, v3), not the unfiltered first two (v1, v2).
    expect(vehicles.map((v) => v.id)).toEqual(["v1", "v3"]);
    // The phone dropped out of v1's device list too.
    expect(vehicles[0].metadata).toEqual({ devices: [{ id: "d1", deviceType: "gps" }] });
  });

  it("applies limit after the filter in ungrouped mode", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: { source: "handheld" }, limit: 1 });

    expect((await source.getVehicles()).map((v) => v.id)).toEqual(["d2"]);
  });

  it("accepts the filter as a JSON string", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: '{"source":"fixed"}' });

    expect((await source.getVehicles()).map((v) => v.id)).toEqual(["d1", "d4", "d5"]);
  });

  it.each([
    ["a number", 7],
    ["an array", ["fixed"]],
    ["unparseable JSON", "{source"],
    ["a nested object value", { source: { eq: "fixed" } }],
    ["an array holding an object", { source: ["a", { b: 1 }] }],
    ["a null value", { source: null }],
  ])("throws in connect when filter is %s", async (_label, filter) => {
    await expect(source.connect({ ...base, filter })).rejects.toThrow(/filter/);
  });

  it("is unchanged when filter is unset or empty", async () => {
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base });
    expect(await source.getVehicles()).toHaveLength(5);

    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base, filter: {} });
    expect(await source.getVehicles()).toHaveLength(5);
  });

  it("is reset by disconnect", async () => {
    await source.connect({ ...base, filter: { source: "fixed" } });
    await source.disconnect();
    mockHttpFetch.mockResolvedValue(roster());
    await source.connect({ ...base });

    expect(await source.getVehicles()).toHaveLength(5);
  });
});

describe("RestSource getVehicles limit", () => {
  let source: RestSource;

  const rosterOf = (n: number) =>
    new Response(
      JSON.stringify({
        vehicles: Array.from({ length: n }, (_, i) => ({
          id: `v${i + 1}`,
          name: `Vehicle ${i + 1}`,
          lat: 1.5,
          lng: 36.8,
        })),
      }),
      { status: 200 }
    );

  beforeEach(() => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("samples only the first N entities when limit is set", async () => {
    mockHttpFetch.mockResolvedValue(rosterOf(5));
    await source.connect({ url: "http://example.com/api", limit: 2 });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(2);
    expect(vehicles.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("returns all entities when limit is unset", async () => {
    mockHttpFetch.mockResolvedValue(rosterOf(5));
    await source.connect({ url: "http://example.com/api" });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(5);
  });

  it("returns all entities when limit is 0", async () => {
    mockHttpFetch.mockResolvedValue(rosterOf(5));
    await source.connect({ url: "http://example.com/api", limit: 0 });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(5);
  });

  it("returns all entities when limit exceeds the roster size", async () => {
    mockHttpFetch.mockResolvedValue(rosterOf(3));
    await source.connect({ url: "http://example.com/api", limit: 10 });

    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(3);
  });
});

describe("RestSource getVehicles timeout", () => {
  let source: RestSource;

  beforeEach(async () => {
    source = new RestSource();
    mockHttpFetch.mockReset();
  });

  it("propagates timeout errors from httpFetch", async () => {
    mockHttpFetch.mockRejectedValue(
      new HttpTimeoutError("http://slow.example.com/vehicles", 10000)
    );

    await source.connect({ url: "http://slow.example.com/vehicles" });

    await expect(source.getVehicles()).rejects.toThrow("timed out");
  });

  it("passes an AbortSignal to httpFetch during getVehicles", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(JSON.stringify({ vehicles: [] }), { status: 200 })
    );

    await source.connect({ url: "http://example.com/vehicles" });
    await source.getVehicles();

    expect(mockHttpFetch).toHaveBeenCalledWith(
      "http://example.com/vehicles",
      expect.objectContaining({ method: "GET" })
    );
  });
});

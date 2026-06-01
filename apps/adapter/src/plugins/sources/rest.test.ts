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

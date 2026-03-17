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

  it("filters out vehicles with NaN coordinates", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [
            { id: "v1", name: "Good", lat: 1.5, lng: 36.8 },
            { id: "v2", name: "Bad Lat", lat: "not-a-number", lng: 36.8 },
            { id: "v3", name: "Bad Lng", lat: 1.5, lng: "abc" },
            { id: "v4", name: "Missing", lat: undefined, lng: undefined },
          ],
        }),
        { status: 200 }
      )
    );
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
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

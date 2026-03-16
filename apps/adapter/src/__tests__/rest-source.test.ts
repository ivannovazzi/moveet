import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestSource } from "../plugins/sources/rest";

vi.mock("../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch, HttpClientError } from "../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

describe("RestSource", () => {
  beforeEach(() => {
    mockHttpFetch.mockReset();
  });

  it("has correct type and name", () => {
    const source = new RestSource();
    expect(source.type).toBe("rest");
    expect(source.name).toBe("REST API");
  });

  it("requires url", async () => {
    const source = new RestSource();
    await expect(source.connect({})).rejects.toThrow("REST source requires url");
  });

  it("fetches and maps vehicles with default field map", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          vehicles: [
            { id: "v1", name: "Bus 1", lat: -1.3, lng: 36.8 },
            { id: "v2", name: "Bus 2", lat: -1.2, lng: 36.7 },
          ],
        }),
        { status: 200 }
      )
    );

    const source = new RestSource();
    await source.connect({ url: "https://api.example.com/vehicles" });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]).toEqual({
      id: "v1",
      name: "Bus 1",
      position: [-1.3, 36.8],
    });
  });

  it("uses custom vehiclePath and fieldMap", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            fleet: [{ vehicle_id: "a1", label: "Truck A", latitude: -1.3, longitude: 36.8 }],
          },
        }),
        { status: 200 }
      )
    );

    const source = new RestSource();
    await source.connect({
      url: "https://api.example.com",
      vehiclePath: "data.fleet",
      fieldMap: { id: "vehicle_id", name: "label", lat: "latitude", lng: "longitude" },
    });
    const vehicles = await source.getVehicles();

    expect(vehicles[0].id).toBe("a1");
    expect(vehicles[0].name).toBe("Truck A");
    expect(vehicles[0].position).toEqual([-1.3, 36.8]);
  });

  it("uses POST method when configured", async () => {
    mockHttpFetch.mockResolvedValue(
      new Response(JSON.stringify({ vehicles: [] }), { status: 200 })
    );

    const source = new RestSource();
    await source.connect({
      url: "https://api.example.com",
      method: "POST",
      body: { filter: "active" },
    });
    await source.getVehicles();

    expect(mockHttpFetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filter: "active" }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    mockHttpFetch.mockRejectedValue(new HttpClientError("HTTP 500 Server Error", 500, true));

    const source = new RestSource();
    await source.connect({ url: "https://api.example.com" });
    await expect(source.getVehicles()).rejects.toThrow("500");
  });

  it("throws when not connected", async () => {
    const source = new RestSource();
    await expect(source.getVehicles()).rejects.toThrow("RestSource: not connected");
  });

  it("returns [] on successful fetch with no vehicles", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vehicles: [] }),
    });

    const source = new RestSource();
    await source.connect({ url: "https://api.example.com" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toEqual([]);
  });

  it("throws on network error during getVehicles", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const source = new RestSource();
    await source.connect({ url: "https://api.example.com" });
    await expect(source.getVehicles()).rejects.toThrow("ECONNREFUSED");
  });

  it("throws after disconnect", async () => {
    const source = new RestSource();
    await source.connect({ url: "https://api.example.com" });
    await source.disconnect();
    await expect(source.getVehicles()).rejects.toThrow("RestSource: not connected");
  });

  it("has config schema", () => {
    const source = new RestSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    expect(source.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });
});

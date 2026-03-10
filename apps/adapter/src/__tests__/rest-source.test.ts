import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestSource } from "../plugins/sources/rest";

describe("RestSource", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vehicles: [
            { id: "v1", name: "Bus 1", lat: -1.3, lng: 36.8 },
            { id: "v2", name: "Bus 2", lat: -1.2, lng: 36.7 },
          ],
        }),
    });

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
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            fleet: [{ vehicle_id: "a1", label: "Truck A", latitude: -1.3, longitude: 36.8 }],
          },
        }),
    });

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
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vehicles: [] }),
    });

    const source = new RestSource();
    await source.connect({
      url: "https://api.example.com",
      method: "POST",
      body: { filter: "active" },
    });
    await source.getVehicles();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filter: "active" }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });

    const source = new RestSource();
    await source.connect({ url: "https://api.example.com" });
    await expect(source.getVehicles()).rejects.toThrow("500");
  });

  it("returns empty when not connected", async () => {
    const source = new RestSource();
    expect(await source.getVehicles()).toEqual([]);
  });

  it("has config schema", () => {
    const source = new RestSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    expect(source.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });
});

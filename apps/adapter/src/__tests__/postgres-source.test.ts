import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockPoolConnect = vi.fn();
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor() {}
    query = mockQuery;
    connect = mockPoolConnect;
    end = mockPoolEnd;
  },
}));

import { PostgresSource } from "../plugins/sources/postgres";

describe("PostgresSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type and name", () => {
    const source = new PostgresSource();
    expect(source.type).toBe("postgres");
    expect(source.name).toBe("PostgreSQL Database");
  });

  it("fetches and maps vehicles", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: "v1", name: "Truck 1", latitude: -1.3, longitude: 36.8 }],
    });

    const source = new PostgresSource();
    await source.connect({ connectionString: "postgresql://user:pass@localhost:5432/fleet" });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toEqual({
      id: "v1",
      name: "Truck 1",
      position: [-1.3, 36.8],
    });
  });

  it("uses custom field map", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ vehicle_id: "p1", vehicle_name: "Car", lat: -1.3, lon: 36.8 }],
    });

    const source = new PostgresSource();
    await source.connect({
      connectionString: "postgresql://localhost/fleet",
      fieldMap: { id: "vehicle_id", name: "vehicle_name", lat: "lat", lng: "lon" },
    });
    const vehicles = await source.getVehicles();
    expect(vehicles[0].id).toBe("p1");
  });

  it("disconnects pool", async () => {
    const source = new PostgresSource();
    await source.connect({ connectionString: "postgresql://localhost/fleet" });
    await source.disconnect();
    expect(mockPoolEnd).toHaveBeenCalled();
  });

  it("throws when not connected", async () => {
    const source = new PostgresSource();
    await expect(source.getVehicles()).rejects.toThrow("PostgresSource: not connected");
  });

  it("throws after disconnect", async () => {
    const source = new PostgresSource();
    await source.connect({ connectionString: "postgresql://user:pass@localhost:5432/fleet" });
    await source.disconnect();
    await expect(source.getVehicles()).rejects.toThrow("PostgresSource: not connected");
  });

  it("returns [] on successful query with no rows", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const source = new PostgresSource();
    await source.connect({ connectionString: "postgresql://user:pass@localhost:5432/fleet" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toEqual([]);
  });

  it("throws on query execution error", async () => {
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    const source = new PostgresSource();
    await source.connect({ connectionString: "postgresql://user:pass@localhost:5432/fleet" });
    await expect(source.getVehicles()).rejects.toThrow("connection terminated");
  });

  it("has config schema", () => {
    const source = new PostgresSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    expect(source.configSchema.find((f) => f.name === "connectionString")).toBeDefined();
    expect(source.configSchema.find((f) => f.name === "password")!.type).toBe("password");
  });

  describe("coordinate validation", () => {
    it("filters out rows with NaN coordinates", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "v1", name: "Truck 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Truck 2", latitude: "not-a-number", longitude: 36.7 },
          { id: "v3", name: "Truck 3", latitude: -1.1, longitude: "bad" },
        ],
      });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("v1");
    });

    it("filters out rows with Infinity coordinates", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "v1", name: "Truck 1", latitude: Infinity, longitude: 36.8 },
          { id: "v2", name: "Truck 2", latitude: -1.3, longitude: -Infinity },
        ],
      });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(0);
    });

    it("passes through rows with valid coordinates including zero", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "v1", name: "Equator Truck", latitude: 0, longitude: 0 },
          { id: "v2", name: "Truck 2", latitude: -1.3, longitude: 36.8 },
        ],
      });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(2);
      expect(vehicles[0].position).toEqual([0, 0]);
    });
  });

  describe("column existence validation", () => {
    it("warns when fieldMap references non-existent columns", async () => {
      mockQuery.mockResolvedValue({
        rows: [{ vehicle_id: "v1", label: "Truck", lat: -1.3, lon: 36.8 }],
      });

      const source = new PostgresSource();
      await source.connect({
        connectionString: "postgresql://localhost/fleet",
        // default fieldMap expects: id, name, latitude, longitude
      });
      // Should complete without throwing even when fieldMap references missing columns
      await expect(source.getVehicles()).resolves.toBeDefined();
    });

    it("skips rows where critical fields (id, lat, lng) are missing", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "v1", name: "Truck 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Truck 2" }, // missing latitude and longitude
          { name: "Truck 3", latitude: -1.1, longitude: 36.7 }, // missing id
        ],
      });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("v1");
    });

    it("uses id as name fallback when name column is missing", async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: "v1", latitude: -1.3, longitude: 36.8 }],
      });

      const source = new PostgresSource();
      await source.connect({
        connectionString: "postgresql://localhost/fleet",
        fieldMap: { id: "id", name: "label", lat: "latitude", lng: "longitude" },
      });

      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].name).toBe("v1"); // falls back to id
    });

    it("handles partial data with some valid and some invalid rows", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: "v1", name: "Truck 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Truck 2", latitude: "NaN", longitude: 36.7 },
          { id: "v3", name: "Truck 3", latitude: -1.1, longitude: 36.9 },
          { name: "Truck 4", latitude: -1.0, longitude: 36.6 }, // missing id
          { id: "v5", name: "Truck 5", latitude: -1.2, longitude: 36.5 },
        ],
      });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(3);
      expect(vehicles.map((v) => v.id)).toEqual(["v1", "v3", "v5"]);
    });

    it("does not warn about columns when result set is empty", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const source = new PostgresSource();
      await source.connect({ connectionString: "postgresql://localhost/fleet" });
      const vehicles = await source.getVehicles();

      expect(vehicles).toEqual([]);
    });
  });
});

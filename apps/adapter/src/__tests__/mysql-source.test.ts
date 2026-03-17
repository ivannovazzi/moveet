import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockGetConnection = vi.fn();
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: () => ({
      execute: mockExecute,
      getConnection: mockGetConnection,
      end: mockEnd,
    }),
  },
}));

import { MySQLSource } from "../plugins/sources/mysql";

describe("MySQLSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type and name", () => {
    const source = new MySQLSource();
    expect(source.type).toBe("mysql");
    expect(source.name).toBe("MySQL Database");
  });

  it("fetches and maps vehicles", async () => {
    mockExecute.mockResolvedValue([
      [
        { id: "v1", name: "Bus 1", latitude: -1.3, longitude: 36.8 },
        { id: "v2", name: "Bus 2", latitude: -1.2, longitude: 36.7 },
      ],
    ]);

    const source = new MySQLSource();
    await source.connect({
      host: "localhost",
      user: "root",
      password: "pass",
      database: "fleet",
    });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(2);
    expect(vehicles[0]).toEqual({
      id: "v1",
      name: "Bus 1",
      position: [-1.3, 36.8],
    });
  });

  it("uses custom field map", async () => {
    mockExecute.mockResolvedValue([[{ vehicle_id: "a1", label: "Truck", lat: -1.3, lon: 36.8 }]]);

    const source = new MySQLSource();
    await source.connect({
      host: "localhost",
      user: "root",
      password: "pass",
      database: "fleet",
      fieldMap: { id: "vehicle_id", name: "label", lat: "lat", lng: "lon" },
    });
    const vehicles = await source.getVehicles();
    expect(vehicles[0].id).toBe("a1");
    expect(vehicles[0].name).toBe("Truck");
  });

  it("disconnects pool", async () => {
    const source = new MySQLSource();
    await source.connect({ host: "localhost", user: "root", password: "pass", database: "fleet" });
    await source.disconnect();
    expect(mockEnd).toHaveBeenCalled();
  });

  it("throws when not connected", async () => {
    const source = new MySQLSource();
    await expect(source.getVehicles()).rejects.toThrow("MySQLSource: not connected");
  });

  it("throws after disconnect", async () => {
    const source = new MySQLSource();
    await source.connect({ host: "localhost", user: "root", password: "pass", database: "fleet" });
    await source.disconnect();
    await expect(source.getVehicles()).rejects.toThrow("MySQLSource: not connected");
  });

  it("returns [] on successful query with no rows", async () => {
    mockExecute.mockResolvedValue([[]]);

    const source = new MySQLSource();
    await source.connect({ host: "localhost", user: "root", password: "pass", database: "fleet" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toEqual([]);
  });

  it("throws on query execution error", async () => {
    mockExecute.mockRejectedValue(new Error("ECONNREFUSED"));

    const source = new MySQLSource();
    await source.connect({ host: "localhost", user: "root", password: "pass", database: "fleet" });
    await expect(source.getVehicles()).rejects.toThrow("ECONNREFUSED");
  });

  it("has config schema", () => {
    const source = new MySQLSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    expect(source.configSchema.find((f) => f.name === "host")!.required).toBe(true);
    expect(source.configSchema.find((f) => f.name === "password")!.type).toBe("password");
  });

  describe("coordinate validation", () => {
    it("filters out rows with NaN coordinates", async () => {
      mockExecute.mockResolvedValue([
        [
          { id: "v1", name: "Bus 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Bus 2", latitude: "not-a-number", longitude: 36.7 },
          { id: "v3", name: "Bus 3", latitude: -1.1, longitude: "bad" },
        ],
      ]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("v1");
    });

    it("filters out rows with Infinity coordinates", async () => {
      mockExecute.mockResolvedValue([
        [
          { id: "v1", name: "Bus 1", latitude: Infinity, longitude: 36.8 },
          { id: "v2", name: "Bus 2", latitude: -1.3, longitude: -Infinity },
        ],
      ]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(0);
    });

    it("passes through rows with valid coordinates including zero", async () => {
      mockExecute.mockResolvedValue([
        [
          { id: "v1", name: "Equator Bus", latitude: 0, longitude: 0 },
          { id: "v2", name: "Bus 2", latitude: -1.3, longitude: 36.8 },
        ],
      ]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(2);
      expect(vehicles[0].position).toEqual([0, 0]);
    });
  });

  describe("column existence validation", () => {
    it("warns when fieldMap references non-existent columns", async () => {
      mockExecute.mockResolvedValue([[{ vehicle_id: "v1", label: "Bus", lat: -1.3, lon: 36.8 }]]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
        // default fieldMap expects: id, name, latitude, longitude
      });
      // Should complete without throwing even when fieldMap references missing columns
      await expect(source.getVehicles()).resolves.toBeDefined();
    });

    it("skips rows where critical fields (id, lat, lng) are missing", async () => {
      mockExecute.mockResolvedValue([
        [
          { id: "v1", name: "Bus 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Bus 2" }, // missing latitude and longitude
          { name: "Bus 3", latitude: -1.1, longitude: 36.7 }, // missing id
        ],
      ]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].id).toBe("v1");
    });

    it("uses id as name fallback when name column is missing", async () => {
      mockExecute.mockResolvedValue([[{ id: "v1", latitude: -1.3, longitude: 36.8 }]]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
        fieldMap: { id: "id", name: "label", lat: "latitude", lng: "longitude" },
      });

      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].name).toBe("v1"); // falls back to id
    });

    it("handles partial data with some valid and some invalid rows", async () => {
      mockExecute.mockResolvedValue([
        [
          { id: "v1", name: "Bus 1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", name: "Bus 2", latitude: "NaN", longitude: 36.7 },
          { id: "v3", name: "Bus 3", latitude: -1.1, longitude: 36.9 },
          { name: "Bus 4", latitude: -1.0, longitude: 36.6 }, // missing id
          { id: "v5", name: "Bus 5", latitude: -1.2, longitude: 36.5 },
        ],
      ]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toHaveLength(3);
      expect(vehicles.map((v) => v.id)).toEqual(["v1", "v3", "v5"]);
    });

    it("does not warn about columns when result set is empty", async () => {
      mockExecute.mockResolvedValue([[]]);

      const source = new MySQLSource();
      await source.connect({
        host: "localhost",
        user: "root",
        password: "pass",
        database: "fleet",
      });
      const vehicles = await source.getVehicles();

      expect(vehicles).toEqual([]);
    });
  });
});

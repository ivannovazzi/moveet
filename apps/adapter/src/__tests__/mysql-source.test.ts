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
});

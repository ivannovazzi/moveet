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
});

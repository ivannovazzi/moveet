import { describe, it, expect } from "vitest";
import { StaticSource } from "../plugins/sources/static";

describe("StaticSource", () => {
  it("has correct type and name", () => {
    const source = new StaticSource();
    expect(source.type).toBe("static");
    expect(source.name).toBe("Static Test Data");
  });

  it("generates vehicles with default count", async () => {
    const source = new StaticSource();
    await source.connect({});
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(10);
  });

  it("generates vehicles with custom count", async () => {
    const source = new StaticSource();
    await source.connect({ count: 5 });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(5);
  });

  it("generates vehicles with correct structure", async () => {
    const source = new StaticSource();
    await source.connect({ count: 1 });
    const [vehicle] = await source.getVehicles();
    expect(vehicle.id).toBe("static-0");
    expect(vehicle.name).toBe("Test Vehicle 1");
    expect(vehicle.position).toHaveLength(2);
    expect(typeof vehicle.position[0]).toBe("number");
    expect(typeof vehicle.position[1]).toBe("number");
  });

  it("clears vehicles on disconnect", async () => {
    const source = new StaticSource();
    await source.connect({ count: 5 });
    await source.disconnect();
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(0);
  });

  it("health check always returns true", async () => {
    const source = new StaticSource();
    expect(await source.healthCheck()).toMatchObject({ healthy: true });
  });

  it("has config schema", () => {
    const source = new StaticSource();
    expect(source.configSchema).toBeDefined();
    expect(source.configSchema.length).toBeGreaterThan(0);
    expect(source.configSchema.find((f) => f.name === "count")).toBeDefined();
  });
});

import { describe, it, expect } from "vitest";
import { StaticSource } from "./static";

describe("StaticSource", () => {
  it("has type 'static'", () => {
    const source = new StaticSource();
    expect(source.type).toBe("static");
  });

  it("generates vehicles on connect with default count", async () => {
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

  it("generates vehicles with correct shape", async () => {
    const source = new StaticSource();
    await source.connect({ count: 1 });
    const [vehicle] = await source.getVehicles();

    expect(vehicle).toHaveProperty("id");
    expect(vehicle).toHaveProperty("name");
    expect(vehicle).toHaveProperty("type");
  });

  it("generates vehicles without hardcoded positions", async () => {
    const source = new StaticSource();
    await source.connect({ count: 10 });
    const vehicles = await source.getVehicles();

    for (const v of vehicles) {
      expect(v.position).toBeUndefined();
    }
  });

  it("clears vehicles on disconnect", async () => {
    const source = new StaticSource();
    await source.connect({ count: 5 });
    await source.disconnect();
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(0);
  });

  it("healthCheck returns true", async () => {
    const source = new StaticSource();
    await source.connect({});
    expect(await source.healthCheck()).toMatchObject({ healthy: true });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { vehicleStore } from "./vehicleStore";
import { createVehicleDTO } from "@/test/mocks/types";

beforeEach(() => {
  vehicleStore.replace([]);
  vehicleStore.setTrailCapacity(60);
});

describe("vehicleStore — trail buffer", () => {
  it("getTrail returns empty array for unknown vehicle", () => {
    expect(vehicleStore.getTrail("nonexistent")).toEqual([]);
  });

  it("set() appends position to vehicle trail", () => {
    const dto = createVehicleDTO({ id: "v1", position: [-1.29, 36.82] });
    vehicleStore.set(dto);

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toEqual([[-1.29, 36.82]]);
  });

  it("set() maintains trail across multiple updates", () => {
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [-1.29, 36.82] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [-1.3, 36.83] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [-1.31, 36.84] }));

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toEqual([
      [-1.29, 36.82],
      [-1.3, 36.83],
      [-1.31, 36.84],
    ]);
  });

  it("trail respects capacity limit (drops oldest)", () => {
    // Set a small capacity to make the test manageable
    vehicleStore.setTrailCapacity(3);

    vehicleStore.set(createVehicleDTO({ id: "v1", position: [1, 1] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [2, 2] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [3, 3] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [4, 4] }));

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toHaveLength(3);
    // Oldest position [1,1] should have been dropped
    expect(trail).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("setTrailCapacity changes buffer size", () => {
    vehicleStore.setTrailCapacity(5);

    for (let i = 0; i < 10; i++) {
      vehicleStore.set(createVehicleDTO({ id: "v1", position: [i, i] }));
    }

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toHaveLength(5);
    expect(trail[0]).toEqual([5, 5]);
    expect(trail[4]).toEqual([9, 9]);
  });

  it("setTrailCapacity trims existing trails when reduced", () => {
    // Start with default capacity, add several positions
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [1, 1] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [2, 2] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [3, 3] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [4, 4] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [5, 5] }));

    expect(vehicleStore.getTrail("v1")).toHaveLength(5);

    // Reduce capacity to 2 — should trim from front (oldest)
    vehicleStore.setTrailCapacity(2);

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toHaveLength(2);
    expect(trail).toEqual([
      [4, 4],
      [5, 5],
    ]);
  });

  it("replace() clears all trails", () => {
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [1, 1] }));
    vehicleStore.set(createVehicleDTO({ id: "v2", position: [2, 2] }));

    expect(vehicleStore.getTrail("v1")).toHaveLength(1);
    expect(vehicleStore.getTrail("v2")).toHaveLength(1);

    vehicleStore.replace([createVehicleDTO({ id: "v1", position: [3, 3] })]);

    expect(vehicleStore.getTrail("v1")).toEqual([]);
    expect(vehicleStore.getTrail("v2")).toEqual([]);
  });

  it("clearTrails() clears trails without affecting vehicles", () => {
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [1, 1] }));
    vehicleStore.set(createVehicleDTO({ id: "v1", position: [2, 2] }));

    expect(vehicleStore.getTrail("v1")).toHaveLength(2);
    expect(vehicleStore.getAll().has("v1")).toBe(true);

    vehicleStore.clearTrails();

    // Trails are gone
    expect(vehicleStore.getTrail("v1")).toEqual([]);
    // But the vehicle is still in the store
    expect(vehicleStore.getAll().has("v1")).toBe(true);
    expect(vehicleStore.getAll().get("v1")!.id).toBe("v1");
  });

  it("default trail capacity is 60", () => {
    // Fill more than 60 positions for a vehicle
    for (let i = 0; i < 70; i++) {
      vehicleStore.set(createVehicleDTO({ id: "v1", position: [i, i] }));
    }

    const trail = vehicleStore.getTrail("v1");
    expect(trail).toHaveLength(60);
    // The first 10 positions (0-9) should have been dropped
    expect(trail[0]).toEqual([10, 10]);
    expect(trail[59]).toEqual([69, 69]);
  });
});

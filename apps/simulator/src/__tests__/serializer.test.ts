import { describe, it, expect } from "vitest";
import { serializeVehicle } from "../utils/serializer";
import type { Vehicle } from "../types";

function makeVehicle(overrides?: Partial<Vehicle>): Vehicle {
  return {
    id: "v-1",
    name: "Alpha",
    position: [1.234, 36.789],
    speed: 45,
    bearing: 135,
    route: null,
    currentEdgeIndex: 0,
    currentEdgeFraction: 0,
    routeProgress: 0,
    interval: null,
    targetSpeed: 45,
    ...overrides,
  } as unknown as Vehicle;
}

describe("serializeVehicle", () => {
  it("maps bearing to heading", () => {
    const v = makeVehicle({ bearing: 270 });
    const dto = serializeVehicle(v);
    expect(dto.heading).toBe(270);
  });

  it("copies id and name unchanged", () => {
    const v = makeVehicle({ id: "v-42", name: "Bravo" });
    const dto = serializeVehicle(v);
    expect(dto.id).toBe("v-42");
    expect(dto.name).toBe("Bravo");
  });

  it("copies position array", () => {
    const v = makeVehicle({ position: [-1.28, 36.82] });
    const dto = serializeVehicle(v);
    expect(dto.position).toEqual([-1.28, 36.82]);
  });

  it("copies speed", () => {
    const v = makeVehicle({ speed: 72 });
    const dto = serializeVehicle(v);
    expect(dto.speed).toBe(72);
  });

  it("sets fleetId when provided", () => {
    const v = makeVehicle();
    const dto = serializeVehicle(v, "fleet-99");
    expect(dto.fleetId).toBe("fleet-99");
  });

  it("leaves fleetId undefined when not provided", () => {
    const v = makeVehicle();
    const dto = serializeVehicle(v);
    expect(dto.fleetId).toBeUndefined();
  });

  it("returns a plain object — does not include extra vehicle fields", () => {
    const v = makeVehicle();
    const dto = serializeVehicle(v);
    const keys = Object.keys(dto);
    expect(keys).toContain("id");
    expect(keys).toContain("name");
    expect(keys).toContain("position");
    expect(keys).toContain("speed");
    expect(keys).toContain("heading");
    // interval, route, etc. are NOT part of the DTO
    expect(keys).not.toContain("interval");
    expect(keys).not.toContain("route");
    expect(keys).not.toContain("bearing");
  });
});

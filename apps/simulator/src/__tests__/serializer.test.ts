import { describe, it, expect } from "vitest";
import { serializeVehicle, serializeRoute } from "../utils/serializer";
import type { Vehicle, Route, Edge, Node as RoadNode } from "../types";

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

// ─── serializeRoute (lean wire copy) ────────────────────────────────

function makeRouteNode(id: string, lat: number, lng: number, trafficSignal?: boolean): RoadNode {
  return { id, coordinates: [lat, lng], connections: [], trafficSignal };
}

function makeRouteEdge(id: string, start: RoadNode, end: RoadNode): Edge {
  const edge: Edge = {
    id,
    streetId: `s-${id}`,
    start,
    end,
    distance: 2,
    bearing: 45,
    maxSpeed: 60,
    name: "Test St",
    oneway: false,
    highway: "residential",
    surface: "asphalt",
    lanes: 2,
    capacity: 3600,
    smoothnessFactor: 0.9,
  };
  // Circular references that serializeRoute must strip.
  start.connections.push(edge);
  end.connections.push(edge);
  return edge;
}

describe("serializeRoute", () => {
  function makeRoute(): Route {
    const a = makeRouteNode("a", 1, 2, true);
    const b = makeRouteNode("b", 3, 4);
    const c = makeRouteNode("c", 5, 6);
    return {
      edges: [makeRouteEdge("e1", a, b), makeRouteEdge("e2", b, c)],
      distance: 4,
    };
  }

  it("strips endpoint-node connections on every edge", () => {
    const out = serializeRoute(makeRoute());
    for (const e of out.edges) {
      expect(e.start.connections).toEqual([]);
      expect(e.end.connections).toEqual([]);
    }
  });

  it("preserves the wire fields per edge", () => {
    const out = serializeRoute(makeRoute());
    const e = out.edges[0];
    expect(e).toMatchObject({
      id: "e1",
      streetId: "s-e1",
      distance: 2,
      bearing: 45,
      maxSpeed: 60,
      name: "Test St",
      oneway: false,
      highway: "residential",
      surface: "asphalt",
      lanes: 2,
      capacity: 3600,
      smoothnessFactor: 0.9,
    });
    expect(e.start.id).toBe("a");
    expect(e.start.coordinates).toEqual([1, 2]);
    expect(e.start.trafficSignal).toBe(true);
    expect(e.end.coordinates).toEqual([3, 4]);
  });

  it("preserves total distance and edge order", () => {
    const out = serializeRoute(makeRoute());
    expect(out.distance).toBe(4);
    expect(out.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("does not mutate the original route's nodes", () => {
    const route = makeRoute();
    serializeRoute(route);
    expect(route.edges[0].start.connections.length).toBeGreaterThan(0);
  });

  it("produces JSON-serializable (non-circular) output", () => {
    const out = serializeRoute(makeRoute());
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

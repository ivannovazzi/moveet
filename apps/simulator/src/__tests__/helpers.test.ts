import { describe, it, expect } from "vitest";
import {
  calculateBearing,
  interpolatePosition,
  calculateDistance,
  nonCircularRouteEdges,
  estimateRouteDuration,
} from "../utils/helpers";
import type { Route, Edge, Node as RoadNode } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────

function makeNode(id: string, lat: number, lng: number): Node {
  return { id, coordinates: [lat, lng], connections: [] };
}

function makeEdge(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  distance: number = 1
): Edge {
  const start = makeNode("a", startLat, startLng);
  const end = makeNode("b", endLat, endLng);
  const edge: Edge = {
    id: "e1",
    streetId: "s1",
    start,
    end,
    distance,
    bearing: 0,
    maxSpeed: 60,
    name: "Test St",
    oneway: false,
    highway: "residential",
    surface: "asphalt",
  };
  // Add edge to connections to create circular references that nonCircularRouteEdges strips
  start.connections.push(edge);
  end.connections.push(edge);
  return edge;
}

function makeRoute(edges: Edge[]): Route {
  return { edges, distance: edges.reduce((s, e) => s + e.distance, 0) };
}

// ─── calculateBearing ───────────────────────────────────────────────

describe("calculateBearing", () => {
  it("returns 0° for due north", () => {
    // Moving north: same lng, increasing lat
    const bearing = calculateBearing([0, 0], [1, 0]);
    expect(bearing).toBeCloseTo(0, 0);
  });

  it("returns 90° for due east", () => {
    // Moving east: same lat, increasing lng
    const bearing = calculateBearing([0, 0], [0, 1]);
    expect(bearing).toBeCloseTo(90, 0);
  });

  it("returns 180° for due south", () => {
    // Moving south: same lng, decreasing lat
    const bearing = calculateBearing([1, 0], [0, 0]);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it("returns 270° for due west", () => {
    // Moving west: same lat, decreasing lng
    const bearing = calculateBearing([0, 1], [0, 0]);
    expect(bearing).toBeCloseTo(270, 0);
  });

  it("returns a value in [0, 360)", () => {
    const bearing = calculateBearing([-1, -1], [1, 1]);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it("returns northeast bearing for diagonal movement", () => {
    const bearing = calculateBearing([0, 0], [1, 1]);
    // NE is around 45°; exact value depends on spherical geometry
    expect(bearing).toBeGreaterThan(0);
    expect(bearing).toBeLessThan(90);
  });
});

// ─── interpolatePosition ────────────────────────────────────────────

describe("interpolatePosition", () => {
  it("returns start when fraction is 0", () => {
    expect(interpolatePosition([10, 20], [30, 40], 0)).toEqual([10, 20]);
  });

  it("returns end when fraction is 1", () => {
    expect(interpolatePosition([10, 20], [30, 40], 1)).toEqual([30, 40]);
  });

  it("returns midpoint when fraction is 0.5", () => {
    expect(interpolatePosition([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
  });

  it("handles negative coordinates", () => {
    const result = interpolatePosition([-10, -20], [10, 20], 0.5);
    expect(result).toEqual([0, 0]);
  });

  it("handles fraction beyond [0,1] for extrapolation", () => {
    const result = interpolatePosition([0, 0], [10, 0], 1.5);
    expect(result[0]).toBeCloseTo(15);
  });
});

// ─── calculateDistance ──────────────────────────────────────────────

describe("calculateDistance", () => {
  it("returns 0 for identical points", () => {
    expect(calculateDistance([10, 20], [10, 20])).toBe(0);
  });

  it("returns a positive distance between two distinct points", () => {
    const d = calculateDistance([0, 0], [1, 0]);
    expect(d).toBeGreaterThan(0);
  });

  it("is symmetric", () => {
    const d1 = calculateDistance([51.5, -0.1], [48.8, 2.3]);
    const d2 = calculateDistance([48.8, 2.3], [51.5, -0.1]);
    expect(d1).toBeCloseTo(d2, 5);
  });

  it("Paris to London is roughly 340 km", () => {
    // Paris [48.85, 2.35], London [51.51, -0.13]
    const d = calculateDistance([48.85, 2.35], [51.51, -0.13]);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it("returns distance in km (Earth radius 6371 km scale)", () => {
    // 1 degree latitude ≈ 111 km
    const d = calculateDistance([0, 0], [1, 0]);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

// ─── nonCircularRouteEdges ──────────────────────────────────────────

describe("nonCircularRouteEdges", () => {
  it("strips connections from start and end nodes", () => {
    const edge = makeEdge(0, 0, 1, 1, 2);
    expect(edge.start.connections.length).toBe(1); // has circular ref
    expect(edge.end.connections.length).toBe(1);

    const route = makeRoute([edge]);
    const result = nonCircularRouteEdges(route);

    expect(result.edges[0].start.connections).toEqual([]);
    expect(result.edges[0].end.connections).toEqual([]);
  });

  it("preserves non-connection properties of nodes", () => {
    const edge = makeEdge(10, 20, 30, 40, 5);
    const route = makeRoute([edge]);
    const result = nonCircularRouteEdges(route);

    expect(result.edges[0].start.id).toBe("a");
    expect(result.edges[0].start.coordinates).toEqual([10, 20]);
    expect(result.edges[0].end.coordinates).toEqual([30, 40]);
  });

  it("does not mutate the original route", () => {
    const edge = makeEdge(0, 0, 1, 1);
    const route = makeRoute([edge]);
    nonCircularRouteEdges(route);

    // Original nodes should still have their connections
    expect(route.edges[0].start.connections.length).toBe(1);
  });

  it("handles multiple edges", () => {
    const edges = [makeEdge(0, 0, 1, 1, 1), makeEdge(1, 1, 2, 2, 2)];
    const route = makeRoute(edges);
    const result = nonCircularRouteEdges(route);

    for (const e of result.edges) {
      expect(e.start.connections).toEqual([]);
      expect(e.end.connections).toEqual([]);
    }
  });
});

// ─── estimateRouteDuration ──────────────────────────────────────────

describe("estimateRouteDuration", () => {
  it("returns 0 for an empty route", () => {
    const route = makeRoute([]);
    expect(estimateRouteDuration(route, 60)).toBe(0);
  });

  it("computes duration as sum(distance / speed) * 3600", () => {
    // Edge with distance=60, speed=60 → 60/60 * 3600 = 3600 s
    const edge = makeEdge(0, 0, 1, 1, 60);
    const route = makeRoute([edge]);
    const duration = estimateRouteDuration(route, 60);
    expect(duration).toBeCloseTo(3600, 0);
  });

  it("divides by higher speed for shorter durations", () => {
    const edge = makeEdge(0, 0, 1, 1, 60);
    const route = makeRoute([edge]);
    const slow = estimateRouteDuration(route, 30);
    const fast = estimateRouteDuration(route, 60);
    expect(slow).toBeGreaterThan(fast);
    expect(slow).toBeCloseTo(fast * 2, 1);
  });

  it("uses speed=1 as default", () => {
    const edge = makeEdge(0, 0, 1, 1, 10);
    const route = makeRoute([edge]);
    const withDefault = estimateRouteDuration(route);
    const withOne = estimateRouteDuration(route, 1);
    expect(withDefault).toBe(withOne);
  });

  it("accumulates multiple edges", () => {
    const edges = [makeEdge(0, 0, 1, 1, 30), makeEdge(1, 1, 2, 2, 30)];
    const route = makeRoute(edges);
    const single = estimateRouteDuration(makeRoute([makeEdge(0, 0, 1, 1, 60)]), 60);
    const multi = estimateRouteDuration(route, 60);
    expect(multi).toBeCloseTo(single, 0); // 30+30 at 60 = 60 at 60
  });
});

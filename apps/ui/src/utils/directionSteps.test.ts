import { describe, it, expect } from "vitest";
import type { Edge, Node, Position } from "@/types";
import {
  bearingToCompass,
  buildDirectionSteps,
  classifyManeuver,
  findActiveEdgeIndex,
  remainingDistanceKm,
  stepIndexForEdge,
  totalDistanceKm,
} from "./directionSteps";

function node(id: string, coordinates: Position): Node {
  return { id, coordinates, connections: [] };
}

let edgeSeq = 0;
function edge(overrides: Partial<Edge> & { bearing: number; distance: number }): Edge {
  edgeSeq += 1;
  const start: Position = [0, 0];
  const end: Position = [0, 0];
  return {
    id: `e${edgeSeq}`,
    streetId: `s${edgeSeq}`,
    start: node(`n${edgeSeq}a`, start),
    end: node(`n${edgeSeq}b`, end),
    highway: "residential",
    maxSpeed: 50,
    surface: "asphalt",
    oneway: false,
    ...overrides,
  } as Edge;
}

describe("bearingToCompass", () => {
  it("maps cardinal and intercardinal bearings", () => {
    expect(bearingToCompass(0)).toBe("north");
    expect(bearingToCompass(45)).toBe("northeast");
    expect(bearingToCompass(90)).toBe("east");
    expect(bearingToCompass(180)).toBe("south");
    expect(bearingToCompass(270)).toBe("west");
  });

  it("normalizes out-of-range and negative bearings", () => {
    expect(bearingToCompass(360)).toBe("north");
    expect(bearingToCompass(-90)).toBe("west");
  });
});

describe("classifyManeuver", () => {
  it("treats near-collinear bearings as straight", () => {
    expect(classifyManeuver(90, 95)).toBe("straight");
    expect(classifyManeuver(90, 80)).toBe("straight");
  });

  it("distinguishes slight / full / sharp turns by magnitude", () => {
    expect(classifyManeuver(0, 30)).toBe("slight-right");
    expect(classifyManeuver(0, 90)).toBe("right");
    expect(classifyManeuver(0, 150)).toBe("sharp-right");
    expect(classifyManeuver(0, -30)).toBe("slight-left");
    expect(classifyManeuver(0, -90)).toBe("left");
    expect(classifyManeuver(0, -150)).toBe("sharp-left");
  });

  it("detects U-turns near ±180", () => {
    expect(classifyManeuver(0, 180)).toBe("uturn");
    expect(classifyManeuver(10, 190)).toBe("uturn");
  });

  it("handles the wraparound at 360/0", () => {
    // 350° → 10° is a 20° right nudge, not a near-U-turn.
    expect(classifyManeuver(350, 10)).toBe("slight-right");
  });
});

describe("buildDirectionSteps", () => {
  it("returns an empty list for a route with no edges", () => {
    expect(buildDirectionSteps([])).toEqual([]);
  });

  it("groups contiguous same-road edges into one step and appends arrival", () => {
    const steps = buildDirectionSteps([
      edge({ name: "Uhuru Highway", bearing: 90, distance: 0.5 }),
      edge({ name: "Uhuru Highway", bearing: 92, distance: 0.7 }),
      edge({ name: "Moi Avenue", bearing: 0, distance: 0.3 }),
    ]);

    expect(steps).toHaveLength(3); // depart + turn + arrive
    expect(steps[0].maneuver).toBe("depart");
    expect(steps[0].road).toBe("Uhuru Highway");
    expect(steps[0].distanceKm).toBeCloseTo(1.2);
    expect(steps[0].instruction).toMatch(/Head east on Uhuru Highway/);

    expect(steps[1].maneuver).toBe("left"); // 92° → 0° is a left turn
    expect(steps[1].road).toBe("Moi Avenue");
    expect(steps[1].instruction).toBe("Turn left onto Moi Avenue");
    expect(steps[1].distanceKm).toBeCloseTo(0.3);

    expect(steps[2].maneuver).toBe("arrive");
  });

  it("labels unnamed edges and splits distinct unnamed ways by streetId", () => {
    const steps = buildDirectionSteps([
      edge({ streetId: "wayA", bearing: 0, distance: 0.4 }),
      edge({ streetId: "wayA", bearing: 5, distance: 0.2 }),
      edge({ streetId: "wayB", bearing: 90, distance: 0.6 }),
    ]);

    expect(steps).toHaveLength(3);
    expect(steps[0].road).toBe("Unnamed road");
    expect(steps[0].distanceKm).toBeCloseTo(0.6);
    expect(steps[1].road).toBe("Unnamed road");
    expect(steps[1].maneuver).toBe("right");
  });

  it("maps each step to a contiguous, non-overlapping edge range", () => {
    const steps = buildDirectionSteps([
      edge({ name: "A", bearing: 0, distance: 1 }),
      edge({ name: "A", bearing: 0, distance: 1 }),
      edge({ name: "B", bearing: 90, distance: 1 }),
    ]);
    expect(steps[0].edgeStart).toBe(0);
    expect(steps[0].edgeEnd).toBe(2);
    expect(steps[1].edgeStart).toBe(2);
    expect(steps[1].edgeEnd).toBe(3);
  });
});

describe("findActiveEdgeIndex / stepIndexForEdge", () => {
  const edges = [
    edge({ name: "A", bearing: 0, distance: 1 }),
    edge({ name: "B", bearing: 90, distance: 1 }),
  ];
  // Position edge midpoints deterministically.
  edges[0].start.coordinates = [0, 0];
  edges[0].end.coordinates = [0, 2]; // mid [0,1]
  edges[1].start.coordinates = [0, 10];
  edges[1].end.coordinates = [0, 12]; // mid [0,11]

  it("returns -1 when position is missing or there are no edges", () => {
    expect(findActiveEdgeIndex(edges, undefined)).toBe(-1);
    expect(findActiveEdgeIndex([], [0, 0])).toBe(-1);
  });

  it("finds the nearest edge by midpoint", () => {
    expect(findActiveEdgeIndex(edges, [0, 1.2])).toBe(0);
    expect(findActiveEdgeIndex(edges, [0, 10.5])).toBe(1);
  });

  it("maps an edge index back to the step that contains it", () => {
    const steps = buildDirectionSteps(edges);
    expect(stepIndexForEdge(steps, 0)).toBe(0);
    expect(stepIndexForEdge(steps, 1)).toBe(1);
    expect(stepIndexForEdge(steps, -1)).toBe(-1);
  });
});

describe("remainingDistanceKm / totalDistanceKm", () => {
  const steps = buildDirectionSteps([
    edge({ name: "A", bearing: 0, distance: 2 }),
    edge({ name: "B", bearing: 90, distance: 3 }),
  ]);

  it("sums distances from the given step onward", () => {
    expect(remainingDistanceKm(steps, 0)).toBeCloseTo(5);
    expect(remainingDistanceKm(steps, 1)).toBeCloseTo(3);
    expect(remainingDistanceKm(steps, -1)).toBeCloseTo(5); // treated as 0
  });

  it("prefers the route's own distance, falling back to summed edges", () => {
    expect(totalDistanceKm({ edges: [], distance: 4.2 })).toBeCloseTo(4.2);
    expect(
      totalDistanceKm({
        edges: [edge({ bearing: 0, distance: 1.5 }), edge({ bearing: 0, distance: 2.5 })],
        distance: 0,
      })
    ).toBeCloseTo(4);
  });
});

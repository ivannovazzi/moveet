import { describe, it, expect } from "vitest";
import path from "path";
import { RoadNetwork } from "../../modules/RoadNetwork";
import {
  computeBaseTravelTime as sharedBase,
  applyDynamicCost as sharedDynamic,
  SIGNAL_DELAY_H,
} from "../../modules/pathfinding/cost";
import { PathNodeHeap } from "../../modules/pathfinding/heap";
import {
  buildGraph,
  findRoute as workerFindRoute,
  computeBaseTravelTime as workerBase,
  applyDynamicCost as workerDynamic,
} from "../../workers/pathfinding-worker";

const fixture = path.join(__dirname, "..", "fixtures", "test-network.geojson");

// ─── Shared cost module ──────────────────────────────────────────────

describe("pathfinding/cost (shared module)", () => {
  const baseEdge = {
    distance: 1, // km
    maxSpeed: 60, // km/h
    surface: "asphalt",
    capacity: 1800,
    smoothnessFactor: 1.0,
  };

  it("computes free-flow time as distance/maxSpeed with no penalties", () => {
    // flow=0 → bprCongestion=1, asphalt → surfacePenalty=1, smoothness 1 → 1
    expect(sharedBase(baseEdge, 0)).toBeCloseTo(1 / 60, 12);
  });

  it("applies a 1.3× surface penalty on unpaved/dirt", () => {
    expect(sharedBase({ ...baseEdge, surface: "unpaved" }, 0)).toBeCloseTo((1 / 60) * 1.3, 12);
    expect(sharedBase({ ...baseEdge, surface: "dirt" }, 0)).toBeCloseTo((1 / 60) * 1.3, 12);
  });

  it("applies the inverse-smoothness penalty", () => {
    expect(sharedBase({ ...baseEdge, smoothnessFactor: 0.5 }, 0)).toBeCloseTo(1 / 60 / 0.5, 12);
  });

  it("applies BPR congestion as a function of flow/capacity", () => {
    const flow = 1800; // ratio 1 → 1 + 0.15 = 1.15
    expect(sharedBase(baseEdge, flow)).toBeCloseTo((1 / 60) * 1.15, 12);
  });

  it("applyDynamicCost divides by incident factor < 1 and adds signal delay", () => {
    const base = 0.02;
    expect(sharedDynamic(base, undefined, false)).toBe(base);
    expect(sharedDynamic(base, 0.5, false)).toBeCloseTo(base / 0.5, 12);
    expect(sharedDynamic(base, undefined, true)).toBeCloseTo(base + SIGNAL_DELAY_H, 12);
    expect(sharedDynamic(base, 0.5, true)).toBeCloseTo(base / 0.5 + SIGNAL_DELAY_H, 12);
  });

  it("ignores an incident factor of exactly 1 (no slowdown)", () => {
    expect(sharedDynamic(0.02, 1, false)).toBe(0.02);
  });
});

// ─── Worker inline cost matches the shared canonical cost ─────────────

describe("worker inline cost stays in lockstep with the shared module", () => {
  const samples: Array<{
    distance: number;
    maxSpeed: number;
    surface: string;
    capacity: number;
    smoothnessFactor: number;
  }> = [
    {
      distance: 1,
      maxSpeed: 60,
      surface: "asphalt",
      capacity: 1800,
      smoothnessFactor: 1.0,
    },
    {
      distance: 2.5,
      maxSpeed: 40,
      surface: "unpaved",
      capacity: 3600,
      smoothnessFactor: 0.6,
    },
    {
      distance: 0.3,
      maxSpeed: 110,
      surface: "dirt",
      capacity: 1800,
      smoothnessFactor: 0.9,
    },
    {
      distance: 5,
      maxSpeed: 30,
      surface: "asphalt",
      capacity: 5400,
      smoothnessFactor: 0.3,
    },
  ];

  it("computeBaseTravelTime matches across flow values", () => {
    for (const edge of samples) {
      for (const flow of [0, 1, 4, 9, 20]) {
        expect(workerBase(edge, flow)).toBe(sharedBase(edge, flow));
      }
    }
  });

  it("applyDynamicCost matches across incident/signal combinations", () => {
    for (const base of [0.005, 0.02, 0.5]) {
      for (const factor of [undefined, 0.2, 0.5, 1] as const) {
        for (const signal of [false, true]) {
          expect(workerDynamic(base, factor, signal)).toBe(sharedDynamic(base, factor, signal));
        }
      }
    }
  });
});

// ─── Heap ─────────────────────────────────────────────────────────────

describe("PathNodeHeap", () => {
  it("pops nodes in ascending fScore order", () => {
    const heap = new PathNodeHeap();
    const scores = [5, 1, 9, 3, 7, 2, 8, 4, 6, 0];
    for (const s of scores) heap.push({ id: String(s), gScore: s, fScore: s });
    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop().fScore);
    expect(out).toEqual([...scores].sort((a, b) => a - b));
  });
});

// ─── Route equivalence: main-thread A* vs worker A* ───────────────────

describe("main-thread and worker A* return equivalent routes", () => {
  it("produces identical edge sequences for the same start/end pairs", () => {
    const network = new RoadNetwork(fixture);
    const workerNodes = buildGraph(fixture);

    // Use the worker graph's node ids (same snapped-coordinate key scheme) as
    // the start/end set so both implementations resolve the same nodes.
    const nodeIds = [...workerNodes.keys()];
    expect(nodeIds.length).toBeGreaterThan(2);

    let comparisons = 0;
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = 0; j < nodeIds.length; j++) {
        if (i === j) continue;
        const startId = nodeIds[i];
        const endId = nodeIds[j];

        const startNode = network.findNearestNode(parseKey(startId));
        const endNode = network.findNearestNode(parseKey(endId));

        const mainRoute = network.findRoute(startNode, endNode);
        const workerRoute = workerFindRoute(workerNodes, startId, endId);

        // Both must agree on reachability.
        expect(Boolean(mainRoute)).toBe(Boolean(workerRoute));

        if (mainRoute && workerRoute) {
          const mainEdgeIds = mainRoute.edges.map((e) => e.id);
          expect(mainEdgeIds).toEqual(workerRoute.edgeIds);
          expect(mainRoute.distance).toBeCloseTo(workerRoute.distance, 9);
          comparisons++;
        }
      }
    }
    expect(comparisons).toBeGreaterThan(0);
  });
});

/** Parse a "lat,lon" snapped node key into a [lat, lon] tuple. */
function parseKey(key: string): [number, number] {
  const [lat, lon] = key.split(",").map(Number);
  return [lat, lon];
}

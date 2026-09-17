import { describe, it, expect } from "vitest";
import path from "path";
import { RoadNetwork } from "../../modules/RoadNetwork";
import {
  computeBaseTravelTime as sharedBase,
  applyDynamicCost as sharedDynamic,
  computeNodeDelayS,
  nodeDelayHours,
  mergeNodeControl,
  clampWeatherFactor,
  MIN_WEATHER_FACTOR,
  type NodeControl,
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

  it("applyDynamicCost divides by incident factor < 1 and adds the node delay", () => {
    const base = 0.02;
    const delayH = 15 / 3600;
    expect(sharedDynamic(base, undefined, 0)).toBe(base);
    expect(sharedDynamic(base, 0.5, 0)).toBeCloseTo(base / 0.5, 12);
    expect(sharedDynamic(base, undefined, delayH)).toBeCloseTo(base + delayH, 12);
    expect(sharedDynamic(base, 0.5, delayH)).toBeCloseTo(base / 0.5 + delayH, 12);
  });

  it("ignores an incident factor of exactly 1 (no slowdown)", () => {
    expect(sharedDynamic(0.02, 1, 0)).toBe(0.02);
  });

  // ─── Weather (fleetsim-all-1ajn.5) ────────────────────────────────

  it("applyDynamicCost divides by a weather factor < 1 when no incident applies", () => {
    const base = 0.02;
    expect(sharedDynamic(base, undefined, 0, 0.5)).toBeCloseTo(base / 0.5, 12);
  });

  it("ignores a weather factor of exactly 1 or undefined", () => {
    expect(sharedDynamic(0.02, undefined, 0, 1)).toBe(0.02);
    expect(sharedDynamic(0.02, undefined, 0, undefined)).toBe(0.02);
  });

  it("composes weather and incident factors multiplicatively", () => {
    const base = 0.02;
    // incident 0.5 x weather 0.8 = combined 0.4
    expect(sharedDynamic(base, 0.5, 0, 0.8)).toBeCloseTo(base / (0.5 * 0.8), 12);
  });

  it("still adds the node delay on top of a weather-scaled travel time", () => {
    const base = 0.02;
    const delayH = 10 / 3600;
    expect(sharedDynamic(base, undefined, delayH, 0.5)).toBeCloseTo(base / 0.5 + delayH, 12);
  });

  it("clampWeatherFactor keeps the factor in (0, 1]", () => {
    expect(clampWeatherFactor(1)).toBe(1);
    expect(clampWeatherFactor(0.7)).toBe(0.7);
    // Never a discount: anything >= 1 (or non-finite) collapses to 1 (no effect).
    expect(clampWeatherFactor(1.5)).toBe(1);
    expect(clampWeatherFactor(Infinity)).toBe(1);
    expect(clampWeatherFactor(NaN)).toBe(1);
    // Never at/below 0 (would price an edge at infinity): floored.
    expect(clampWeatherFactor(0)).toBe(MIN_WEATHER_FACTOR);
    expect(clampWeatherFactor(-1)).toBe(MIN_WEATHER_FACTOR);
    expect(clampWeatherFactor(0.01)).toBe(MIN_WEATHER_FACTOR);
  });
});

// ─── Typed node-control delays (fleetsim-all-1ajn.2) ──────────────────

describe("computeNodeDelayS", () => {
  it("gives a signalized major-road approach less delay than a minor one", () => {
    const control: NodeControl = { kind: "traffic_signals", direction: "both" };
    const major = computeNodeDelayS(control, "primary");
    const minor = computeNodeDelayS(control, "residential");
    expect(major).toBeGreaterThan(0);
    expect(major).toBeLessThan(minor);
  });

  it("halves the signal delay when traffic_signals:direction is one-directional", () => {
    const both = computeNodeDelayS({ kind: "traffic_signals", direction: "both" }, "primary");
    const forward = computeNodeDelayS({ kind: "traffic_signals", direction: "forward" }, "primary");
    expect(forward).toBeCloseTo(both / 2, 12);
  });

  it("gives a mandatory stop a fixed delay regardless of approach class", () => {
    const major = computeNodeDelayS({ kind: "stop" }, "primary");
    const minor = computeNodeDelayS({ kind: "stop" }, "residential");
    expect(major).toBe(minor);
    expect(major).toBeGreaterThan(0);
  });

  it("gives give-way a smaller delay than a full stop", () => {
    expect(computeNodeDelayS({ kind: "give_way" }, "residential")).toBeLessThan(
      computeNodeDelayS({ kind: "stop" }, "residential")
    );
  });

  it("scales crossing delay by crossing subtype: signal > marked > unmarked", () => {
    const signal = computeNodeDelayS({ kind: "crossing", subtype: "traffic_signals" }, "primary");
    const marked = computeNodeDelayS({ kind: "crossing", subtype: "marked" }, "primary");
    const unmarked = computeNodeDelayS({ kind: "crossing", subtype: "unmarked" }, "primary");
    expect(signal).toBeGreaterThan(marked);
    expect(marked).toBeGreaterThan(unmarked);
    expect(unmarked).toBeGreaterThan(0);
  });

  it("treats zebra/uncontrolled/unspecified crossings like marked", () => {
    const marked = computeNodeDelayS({ kind: "crossing", subtype: "marked" }, "primary");
    expect(computeNodeDelayS({ kind: "crossing", subtype: "zebra" }, "primary")).toBe(marked);
    expect(computeNodeDelayS({ kind: "crossing", subtype: "uncontrolled" }, "primary")).toBe(
      marked
    );
    expect(computeNodeDelayS({ kind: "crossing" }, "primary")).toBe(marked);
  });

  it("gives a railway level crossing a small positive expected delay", () => {
    expect(computeNodeDelayS({ kind: "level_crossing" }, "primary")).toBeGreaterThan(0);
  });

  it("gives point traffic-calming a small positive delay, varying by subtype", () => {
    const table = computeNodeDelayS({ kind: "traffic_calming", subtype: "table" }, "residential");
    const rumble = computeNodeDelayS(
      { kind: "traffic_calming", subtype: "rumble_strip" },
      "residential"
    );
    expect(table).toBeGreaterThan(0);
    expect(rumble).toBeGreaterThan(0);
    expect(table).toBeGreaterThan(rumble);
  });

  it("never produces a negative delay", () => {
    const kinds: NodeControl[] = [
      { kind: "traffic_signals", direction: "both" },
      { kind: "stop" },
      { kind: "give_way" },
      { kind: "crossing", subtype: "unmarked" },
      { kind: "level_crossing" },
      { kind: "traffic_calming", subtype: "bump" },
    ];
    for (const control of kinds) {
      expect(computeNodeDelayS(control, "residential")).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("nodeDelayHours", () => {
  it("returns 0 for an undefined control", () => {
    expect(nodeDelayHours(undefined, "primary")).toBe(0);
  });

  it("converts computeNodeDelayS's seconds to hours", () => {
    const control: NodeControl = { kind: "stop" };
    expect(nodeDelayHours(control, "residential")).toBeCloseTo(
      computeNodeDelayS(control, "residential") / 3600,
      12
    );
  });
});

describe("mergeNodeControl", () => {
  it("keeps the incoming control when nothing exists yet", () => {
    const incoming: NodeControl = { kind: "stop" };
    expect(mergeNodeControl(undefined, incoming)).toBe(incoming);
  });

  it("prefers a level crossing over a traffic signal at the same node", () => {
    const signal: NodeControl = { kind: "traffic_signals", direction: "both" };
    const crossing: NodeControl = { kind: "level_crossing" };
    expect(mergeNodeControl(signal, crossing)).toBe(crossing);
    expect(mergeNodeControl(crossing, signal)).toBe(crossing);
  });

  it("prefers a stop over a give-way", () => {
    const stop: NodeControl = { kind: "stop" };
    const giveWay: NodeControl = { kind: "give_way" };
    expect(mergeNodeControl(giveWay, stop)).toBe(stop);
    expect(mergeNodeControl(stop, giveWay)).toBe(stop);
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

  it("applyDynamicCost matches across incident/node-delay combinations", () => {
    for (const base of [0.005, 0.02, 0.5]) {
      for (const factor of [undefined, 0.2, 0.5, 1] as const) {
        for (const nodeDelayH of [0, 15 / 3600, 25 / 3600]) {
          expect(workerDynamic(base, factor, nodeDelayH)).toBe(
            sharedDynamic(base, factor, nodeDelayH)
          );
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

// ─── Turn model inputs: main-thread graph vs worker graph (fleetsim-all-1ajn.3) ──

describe("main-thread and worker graphs agree on turn-model inputs", () => {
  it("stamps identical node degrees, signal flags and edge bearings/oneway", () => {
    const network = new RoadNetwork(fixture);
    const workerNodes = buildGraph(fixture);
    // @ts-expect-error — private graph, as the other RoadNetwork tests do.
    const mainNodes = network.nodes as Map<string, import("../../types").Node>;

    expect([...workerNodes.keys()]).toEqual([...mainNodes.keys()]);
    for (const [id, workerNode] of workerNodes) {
      const mainNode = mainNodes.get(id)!;
      expect(workerNode.degree).toBe(mainNode.degree);
      expect(Boolean(workerNode.trafficSignal)).toBe(Boolean(mainNode.trafficSignal));
      expect(workerNode.edges.map((e) => e.id)).toEqual(mainNode.connections.map((e) => e.id));
      workerNode.edges.forEach((edge, i) => {
        expect(edge.bearing).toBe(mainNode.connections[i].bearing);
        expect(edge.oneway).toBe(mainNode.connections[i].oneway);
      });
    }
  });

  it("returns identical routes in left-hand traffic too", () => {
    const network = new RoadNetwork(fixture, { driveSide: "left" });
    const workerNodes = buildGraph(fixture, undefined, undefined, "left");
    const nodeIds = [...workerNodes.keys()];
    for (const a of nodeIds) {
      for (const b of nodeIds) {
        if (a === b) continue;
        const main = network.findRoute(
          network.findNearestNode(parseKey(a)),
          network.findNearestNode(parseKey(b))
        );
        const worker = workerFindRoute(workerNodes, a, b);
        expect(main ? main.edges.map((e) => e.id) : null).toEqual(worker ? worker.edgeIds : null);
      }
    }
  });
});

/** Parse a "lat,lon" snapped node key into a [lat, lon] tuple. */
function parseKey(key: string): [number, number] {
  const [lat, lon] = key.split(",").map(Number);
  return [lat, lon];
}

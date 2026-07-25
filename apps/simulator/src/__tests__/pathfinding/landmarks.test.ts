import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { FeatureCollection } from "geojson";
import type { Edge, Node } from "../../types";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { GraphBuilder } from "../../modules/roadnetwork/GraphBuilder";
import { applyDynamicCost } from "../../modules/pathfinding/cost";
import { NumericHeap } from "../../modules/pathfinding/heap";
import {
  AltHeuristic,
  DEFAULT_LANDMARK_COUNT,
  MAX_LANDMARK_COUNT,
  type AltIndexed,
  buildCsrPair,
  buildLandmarkIndex,
  landmarkIndexBytes,
  resolveLandmarkCount,
  sortedNodeIds,
} from "../../modules/pathfinding/landmarks";
import {
  buildGraph,
  findRoute as workerFindRoute,
  landmarkHeuristic,
} from "../../workers/pathfinding-worker";

/**
 * ALT (A*, Landmarks, Triangle inequality) heuristic.
 *
 * The load-bearing test here is ROUTE EQUIVALENCE: with `PATHFINDING_LANDMARKS=0`
 * the engine uses exactly the pre-ALT haversine heuristic, so comparing an
 * `L=0` run against an `L=N` run over every node pair is a direct assertion
 * that the optimisation did not change any route. Everything else (admissibility,
 * expansion counts) supports that claim.
 */

const fixture = path.join(__dirname, "..", "fixtures", "test-network.geojson");
const integrationFixture = path.join(__dirname, "..", "fixtures", "integration-network.geojson");

/** Restore whatever the ambient env had, since these tests toggle it. */
const originalEnv = process.env.PATHFINDING_LANDMARKS;
beforeEach(() => {
  delete process.env.PATHFINDING_LANDMARKS;
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.PATHFINDING_LANDMARKS;
  else process.env.PATHFINDING_LANDMARKS = originalEnv;
});

function buildNetwork(landmarks: string, geojsonPath = fixture): RoadNetwork {
  process.env.PATHFINDING_LANDMARKS = landmarks;
  return new RoadNetwork(geojsonPath);
}

/** All node ids of a network, in a stable order. */
function nodeIdsOf(network: RoadNetwork): string[] {
  // @ts-expect-error — reaching into the private graph, as the other RoadNetwork tests do.
  return sortedNodeIds((network.nodes as Map<string, Node>).keys());
}

function nodeOf(network: RoadNetwork, id: string): Node {
  // @ts-expect-error — reaching into the private graph, as the other RoadNetwork tests do.
  return (network.nodes as Map<string, Node>).get(id)!;
}

/** Serialise a route to a comparable form. */
function describeRoute(route: { edges: Edge[]; distance: number } | null): string {
  if (!route) return "NO_ROUTE";
  return `${route.distance.toFixed(12)}|${route.edges.map((e) => e.id).join(">")}`;
}

// ─── resolveLandmarkCount ─────────────────────────────────────────────

describe("resolveLandmarkCount", () => {
  it("defaults when unset or blank", () => {
    expect(resolveLandmarkCount(undefined)).toBe(DEFAULT_LANDMARK_COUNT);
    expect(resolveLandmarkCount("")).toBe(DEFAULT_LANDMARK_COUNT);
    expect(resolveLandmarkCount("   ")).toBe(DEFAULT_LANDMARK_COUNT);
  });

  it("accepts 0 as an explicit disable", () => {
    expect(resolveLandmarkCount("0")).toBe(0);
  });

  it("parses valid counts and clamps to the ceiling", () => {
    expect(resolveLandmarkCount("6")).toBe(6);
    expect(resolveLandmarkCount("1000")).toBe(MAX_LANDMARK_COUNT);
  });

  it("falls back to the default on garbage or negative input", () => {
    expect(resolveLandmarkCount("banana")).toBe(DEFAULT_LANDMARK_COUNT);
    expect(resolveLandmarkCount("-3")).toBe(DEFAULT_LANDMARK_COUNT);
  });

  it("reads process.env by default", () => {
    process.env.PATHFINDING_LANDMARKS = "7";
    expect(resolveLandmarkCount()).toBe(7);
  });
});

// ─── NumericHeap ──────────────────────────────────────────────────────

describe("NumericHeap", () => {
  it("pops ids in ascending key order and grows past its initial capacity", () => {
    const heap = new NumericHeap(2);
    const keys = [5, 1, 9, 3, 7, 2, 8, 4, 6, 0];
    keys.forEach((k, i) => {
      heap.push(i, k);
    });
    expect(heap.size).toBe(keys.length);

    const popped: number[] = [];
    while (heap.size > 0) {
      popped.push(heap.peekKey());
      heap.pop();
    }
    expect(popped).toEqual([...keys].sort((a, b) => a - b));
  });

  it("clear() empties the heap without breaking reuse", () => {
    const heap = new NumericHeap(4);
    heap.push(1, 10);
    heap.push(2, 5);
    heap.clear();
    expect(heap.size).toBe(0);
    heap.push(3, 42);
    expect(heap.peekKey()).toBe(42);
    expect(heap.pop()).toBe(3);
  });
});

// ─── CSR + landmark preprocessing on a hand-built graph ───────────────

describe("buildCsrPair / buildLandmarkIndex", () => {
  /**
   * A deliberately asymmetric 4-node chain plus one isolated node:
   *   0 →(1)→ 1 →(2)→ 2 →(4)→ 3        (3 has no outgoing edges)
   *   node 4 is disconnected entirely.
   */
  const nodeCount = 5;
  const from = Int32Array.from([0, 1, 2]);
  const to = Int32Array.from([1, 2, 3]);
  const weight = Float64Array.from([1, 2, 4]);

  it("builds forward and reverse adjacency that mirror each other", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    expect([...forward.offsets]).toEqual([0, 1, 2, 3, 3, 3]);
    expect([...forward.targets]).toEqual([1, 2, 3]);
    expect([...reverse.offsets]).toEqual([0, 0, 1, 2, 3, 3]);
    // Reverse edge of node 1 points back at node 0, etc.
    expect([...reverse.targets]).toEqual([0, 1, 2]);
    expect([...reverse.weights]).toEqual([1, 2, 4]);
  });

  it("computes exact forward and backward distances per landmark", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    const index = buildLandmarkIndex(forward, reverse, 1)!;
    expect(index.count).toBe(1);
    // Farthest node from index 0 is node 3 (cost 1+2+4=7), so it is landmark 0.
    expect([...index.landmarks]).toEqual([3]);
    // Nothing leaves node 3, so every other node is unreachable FROM it.
    expect([...index.distFrom]).toEqual([Infinity, Infinity, Infinity, 0, Infinity]);
    // Distances INTO node 3.
    expect([...index.distTo]).toEqual([7, 6, 4, 0, Infinity]);
  });

  it("spreads landmarks with farthest-point selection", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    const index = buildLandmarkIndex(forward, reverse, 3)!;
    expect(index.count).toBe(3);
    // First is the farthest node from the seed; later picks maximise the
    // distance to the closest already-chosen landmark. The isolated node 4 is
    // never chosen — unreachable counts as distance 0 by design.
    expect([...index.landmarks]).not.toContain(4);
    expect(new Set(index.landmarks).size).toBe(3);
  });

  it("returns null when disabled or when the graph is empty", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    expect(buildLandmarkIndex(forward, reverse, 0)).toBeNull();
    const empty = buildCsrPair(0, new Int32Array(0), new Int32Array(0), new Float64Array(0), 0);
    expect(buildLandmarkIndex(empty.forward, empty.reverse, 4)).toBeNull();
  });

  it("caps the landmark count at the node count", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    expect(buildLandmarkIndex(forward, reverse, 50)!.count).toBe(nodeCount);
  });

  it("reports the memory held by the distance tables", () => {
    const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
    const index = buildLandmarkIndex(forward, reverse, 2)!;
    expect(landmarkIndexBytes(index)).toBe(2 * 2 * nodeCount * 8);
    expect(landmarkIndexBytes(null)).toBe(0);
  });
});

describe("AltHeuristic", () => {
  const nodeCount = 5;
  const from = Int32Array.from([0, 1, 2]);
  const to = Int32Array.from([1, 2, 3]);
  const weight = Float64Array.from([1, 2, 4]);
  const { forward, reverse } = buildCsrPair(nodeCount, from, to, weight, 3);
  const index = buildLandmarkIndex(forward, reverse, 2)!;

  it("is zero at the target", () => {
    const alt = new AltHeuristic(index);
    expect(alt.setTarget(3)).toBe(true);
    expect(alt.bound(3)).toBe(0);
  });

  it("recovers the exact distance on a chain (the bound is tight here)", () => {
    const alt = new AltHeuristic(index);
    alt.setTarget(3);
    expect(alt.bound(0)).toBeCloseTo(7, 12);
    expect(alt.bound(1)).toBeCloseTo(6, 12);
    expect(alt.bound(2)).toBeCloseTo(4, 12);
  });

  it("deactivates for an unknown, out-of-range or absent target index", () => {
    const alt = new AltHeuristic(index);
    expect(alt.setTarget(undefined)).toBe(false);
    expect(alt.active).toBe(false);
    expect(alt.setTarget(-1)).toBe(false);
    expect(alt.setTarget(nodeCount + 10)).toBe(false);
    expect(alt.bound(0)).toBe(0);
  });

  it("returns a trivial 0 bound for nodes outside the index", () => {
    const alt = new AltHeuristic(index);
    alt.setTarget(3);
    expect(alt.bound(-1)).toBe(0);
    expect(alt.bound(999)).toBe(0);
  });

  it("reports an infinite bound for a node that provably cannot reach the target", () => {
    const alt = new AltHeuristic(index);
    alt.setTarget(3);
    // Node 4 is isolated, so it cannot reach landmark 3 while the target can.
    // Infinity is the correct (and tightest) bound, not an overflow bug.
    expect(alt.bound(4)).toBe(Infinity);
  });

  it("never mistakes 'landmark cannot reach v' for 'v cannot reach target'", () => {
    // Chain 0→1→2→3 with landmark 3: nothing is reachable FROM node 3, so the
    // out-of-landmark term must contribute nothing rather than +Infinity.
    const single = buildLandmarkIndex(forward, reverse, 1)!;
    expect([...single.landmarks]).toEqual([3]);
    const alt = new AltHeuristic(single);
    alt.setTarget(2);
    // distFrom[3][2] is Infinity, so the target is only bounded by the "into
    // the landmark" term: d(0,2) >= distTo[3][0] - distTo[3][2] = 7 - 4 = 3.
    expect(alt.bound(0)).toBeCloseTo(3, 12);
    expect(Number.isFinite(alt.bound(0))).toBe(true);
  });
});

// ─── Admissibility against the real A* cost ───────────────────────────

describe("the landmark bound never overestimates the true A* cost", () => {
  for (const geojsonPath of [fixture, integrationFixture]) {
    it(`holds for every reachable node pair in ${path.basename(geojsonPath)}`, () => {
      process.env.PATHFINDING_LANDMARKS = "4";
      const data = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as FeatureCollection;
      const built = new GraphBuilder().build(data);
      expect(built.landmarks).not.toBeNull();

      const network = buildNetwork("4", geojsonPath);
      const ids = nodeIdsOf(network);
      const alt = new AltHeuristic(built.landmarks!);

      let checked = 0;
      for (const startId of ids) {
        for (const endId of ids) {
          if (startId === endId) continue;
          const route = network.findRoute(nodeOf(network, startId), nodeOf(network, endId));
          if (!route) continue;

          // The true cost A* minimises: base cost plus the dynamic signal term.
          let trueCost = 0;
          for (const edge of route.edges) {
            trueCost += applyDynamicCost(
              built.edgeBaseCost.get(edge.id)!,
              undefined,
              edge.end.trafficSignal === true
            );
          }

          const target = (nodeOf(network, endId) as Node & AltIndexed).altIndex;
          expect(alt.setTarget(target)).toBe(true);
          const bound = alt.bound((nodeOf(network, startId) as Node & AltIndexed).altIndex ?? -1);
          expect(bound).toBeLessThanOrEqual(trueCost + 1e-12);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

// ─── Route equivalence: landmarks OFF vs ON (main thread) ─────────────

describe("main-thread routes are byte-identical with and without landmarks", () => {
  for (const geojsonPath of [fixture, integrationFixture]) {
    const name = path.basename(geojsonPath);

    it(`matches for every node pair in ${name}`, () => {
      const baseline = buildNetwork("0", geojsonPath);
      const ids = nodeIdsOf(baseline);
      const before = new Map<string, string>();
      for (const startId of ids) {
        for (const endId of ids) {
          if (startId === endId) continue;
          before.set(
            `${startId}->${endId}`,
            describeRoute(baseline.findRoute(nodeOf(baseline, startId), nodeOf(baseline, endId)))
          );
        }
      }
      expect(before.size).toBeGreaterThan(0);

      for (const count of ["1", "4", "16"]) {
        const withAlt = buildNetwork(count, geojsonPath);
        expect(nodeIdsOf(withAlt)).toEqual(ids);
        for (const [key, expected] of before) {
          const [startId, endId] = key.split("->");
          const actual = describeRoute(
            withAlt.findRoute(nodeOf(withAlt, startId), nodeOf(withAlt, endId))
          );
          expect(`L=${count} ${key}: ${actual}`).toBe(`L=${count} ${key}: ${expected}`);
        }
      }
    });

    it(`matches while incidents are active in ${name}`, () => {
      // Two incident scenarios: a slowdown (cost multiplier) and a hard closure
      // (edge removed). Both must leave the ALT and non-ALT runs in agreement.
      const scenarios = ["slowdown", "closure"] as const;

      for (const scenario of scenarios) {
        const baseline = buildNetwork("0", geojsonPath);
        const ids = nodeIdsOf(baseline);
        // @ts-expect-error — private edge map, as the other RoadNetwork tests do.
        const edgeIds = [...(baseline.edges as Map<string, Edge>).keys()].sort();
        // Deterministic, spread-out subset of the graph's edges.
        const affected = edgeIds.filter((_, i) => i % 3 === 0);
        const factor = scenario === "closure" ? 0 : 0.25;
        const incidents = new Map(affected.map((id) => [id, factor]));

        baseline.setIncidentEdges(new Map(incidents));
        const before = new Map<string, string>();
        for (const startId of ids) {
          for (const endId of ids) {
            if (startId === endId) continue;
            before.set(
              `${startId}->${endId}`,
              describeRoute(baseline.findRoute(nodeOf(baseline, startId), nodeOf(baseline, endId)))
            );
          }
        }

        const withAlt = buildNetwork("4", geojsonPath);
        withAlt.setIncidentEdges(new Map(incidents));
        for (const [key, expected] of before) {
          const [startId, endId] = key.split("->");
          const actual = describeRoute(
            withAlt.findRoute(nodeOf(withAlt, startId), nodeOf(withAlt, endId))
          );
          expect(`${scenario} ${key}: ${actual}`).toBe(`${scenario} ${key}: ${expected}`);
        }
        // The closure scenario must actually block something, otherwise this
        // test would silently degrade into a no-incident rerun.
        if (scenario === "closure") {
          expect(affected.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it("PATHFINDING_LANDMARKS=0 really does disable preprocessing", () => {
    process.env.PATHFINDING_LANDMARKS = "0";
    const data = JSON.parse(fs.readFileSync(fixture, "utf8")) as FeatureCollection;
    expect(new GraphBuilder().build(data).landmarks).toBeNull();
  });
});

// ─── Route equivalence: landmarks OFF vs ON (worker) ──────────────────

describe("worker routes are byte-identical with and without landmarks", () => {
  it("matches for every node pair in the fixture", () => {
    // buildGraph installs the module-level heuristic, so these two passes must
    // stay sequential — build, exhaust, rebuild.
    process.env.PATHFINDING_LANDMARKS = "0";
    const plainNodes = buildGraph(fixture);
    expect(landmarkHeuristic()).toBeNull();

    const ids = [...plainNodes.keys()].sort();
    const before = new Map<string, string>();
    for (const startId of ids) {
      for (const endId of ids) {
        if (startId === endId) continue;
        const route = workerFindRoute(plainNodes, startId, endId);
        before.set(
          `${startId}->${endId}`,
          route ? `${route.distance.toFixed(12)}|${route.edgeIds.join(">")}` : "NO_ROUTE"
        );
      }
    }
    expect(before.size).toBeGreaterThan(0);

    process.env.PATHFINDING_LANDMARKS = "4";
    const altNodes = buildGraph(fixture);
    expect(landmarkHeuristic()).not.toBeNull();
    expect([...altNodes.keys()].sort()).toEqual(ids);

    for (const [key, expected] of before) {
      const [startId, endId] = key.split("->");
      const route = workerFindRoute(altNodes, startId, endId);
      const actual = route
        ? `${route.distance.toFixed(12)}|${route.edgeIds.join(">")}`
        : "NO_ROUTE";
      expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
    }
  });

  it("assigns the same sorted ALT indices as the main-thread GraphBuilder", () => {
    // This is what lets both sides select the same landmarks — and therefore run
    // the identical search — without exchanging any preprocessed data.
    process.env.PATHFINDING_LANDMARKS = "4";
    const workerNodes = buildGraph(fixture);
    const data = JSON.parse(fs.readFileSync(fixture, "utf8")) as FeatureCollection;
    const built = new GraphBuilder().build(data);

    expect([...workerNodes.keys()].sort()).toEqual(sortedNodeIds(built.nodes.keys()));
    for (const [id, workerNode] of workerNodes) {
      const mainNode = built.nodes.get(id) as Node & AltIndexed;
      expect(workerNode.altIndex).toBe(mainNode.altIndex);
    }
  });
});

import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { RoadNetwork } from "../../modules/RoadNetwork";
import {
  MIN_LEARNED_SPEED_KMH,
  clampLearnedSpeed,
  computeBaseTravelTime,
  landmarkLowerBoundCost,
  learnedTravelTime,
} from "../../modules/pathfinding/cost";
import {
  buildGraph,
  findRoute as workerFindRoute,
  applySpeedOverrides as workerApplySpeedOverrides,
} from "../../workers/pathfinding-worker";
import type { Edge, Node, Route } from "../../types";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

// Learned per-edge speeds in the route search (fleetsim-all-1ajn.4).

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

const integrationFixture = path.join(__dirname, "..", "fixtures", "integration-network.geojson");

function grid(options: { speedProfileRatio?: number | null; landmarkCount?: number } = {}) {
  const file = writeTmpNetwork(gridFeatures());
  tmpFiles.push(file);
  return {
    file,
    rn: new RoadNetwork(file, { landmarkCount: options.landmarkCount ?? 2, ...options }),
  };
}

function edgeBetween(rn: RoadNetwork, a: [number, number], b: [number, number]): Edge {
  const from = rn.findNearestNode(a);
  const to = rn.findNearestNode(b);
  return from.connections.find((e) => e.end.id === to.id)!;
}

const ids = (r: Route | null) => (r ? r.edges.map((e) => e.id) : null);

/** Sparse override table from `[edgeIndex, speedKmh]` pairs. */
function table(entries: Array<[number, number]>) {
  return {
    indices: Int32Array.from(entries.map(([i]) => i)),
    speeds: Float32Array.from(entries.map(([, s]) => s)),
  };
}

describe("learned-speed cost helpers", () => {
  it("clamps a learned speed to [floor, freeFlow x ratio]", () => {
    expect(clampLearnedSpeed(0.01, 30, 1)).toBe(MIN_LEARNED_SPEED_KMH);
    expect(clampLearnedSpeed(20, 30, 1)).toBe(20);
    expect(clampLearnedSpeed(45, 30, 1)).toBe(30);
    expect(clampLearnedSpeed(45, 30, 1.25)).toBe(37.5);
  });

  it("prices a learned edge at distance / clamped speed", () => {
    expect(learnedTravelTime(2, 20, 30, 1)).toBeCloseTo(0.1, 12);
    expect(learnedTravelTime(2, 90, 30, 1)).toBeCloseTo(2 / 30, 12);
  });

  it("builds a landmark weight that never exceeds the static or any learned cost", () => {
    const edge = {
      distance: 0.4,
      maxSpeed: 50,
      freeFlowSpeed: 30,
      surface: "unpaved",
      smoothnessFactor: 0.6,
    };
    const base = computeBaseTravelTime(edge, 3);
    for (const ratio of [1, 1.2, 2]) {
      const lb = landmarkLowerBoundCost(base, edge.distance, edge.freeFlowSpeed, ratio);
      expect(lb).toBeLessThanOrEqual(base);
      for (const speed of [0, 1, 10, 30, 36, 60, 1000]) {
        expect(lb).toBeLessThanOrEqual(learnedTravelTime(edge.distance, speed, 30, ratio) + 1e-15);
      }
    }
  });

  it("keeps the static base cost as the landmark weight when profiles are disabled", () => {
    expect(landmarkLowerBoundCost(0.02, 1, 30, null)).toBe(0.02);
  });
});

describe("RoadNetwork speed overrides", () => {
  const west = gridPos(1, 0);
  const centre = gridPos(1, 1);
  const east = gridPos(1, 2);

  it("indexes every graph edge densely and rejects synthetic ones", () => {
    const { rn } = grid({ speedProfileRatio: 1 });
    const seen = new Set<number>();
    for (let i = 0; i < rn.edgeCount; i++) {
      const edge = rn.edgeAt(i)!;
      expect(rn.edgeIndexOf(edge)).toBe(i);
      seen.add(i);
    }
    expect(seen.size).toBe(rn.edgeCount);
    const real = edgeBetween(rn, west, centre);
    expect(rn.edgeIndexOf(rn.getFallbackEdge(real))).toBe(-1);
  });

  it("routes around an edge learned to be slow", () => {
    const { rn } = grid({ speedProfileRatio: 1 });
    const start = rn.findNearestNode(west);
    const end = rn.findNearestNode(east);
    const straight = ids(rn.findRoute(start, end))!;
    const slow = edgeBetween(rn, west, centre);
    expect(straight).toContain(slow.id);

    expect(rn.setSpeedOverrides(table([[rn.edgeIndexOf(slow), 1]]))).toBe(true);
    expect(rn.learnedSpeedKmh(slow)).toBe(1);
    const detour = ids(rn.findRoute(start, end))!;
    expect(detour).not.toContain(slow.id);

    // Clearing the table restores the static route (and is not served from cache).
    rn.setSpeedOverrides(table([]));
    expect(rn.learnedSpeedKmh(slow)).toBeUndefined();
    expect(ids(rn.findRoute(start, end))).toEqual(straight);
  });

  it("clamps a learned speed above free-flow x ratio", () => {
    const { rn } = grid({ speedProfileRatio: 1.5 });
    const edge = edgeBetween(rn, west, centre);
    rn.setSpeedOverrides(table([[rn.edgeIndexOf(edge), 500]]));
    expect(rn.learnedSpeedKmh(edge)).toBeCloseTo(edge.freeFlowSpeed! * 1.5, 5);
  });

  it("ignores overrides when speed profiles are disabled", () => {
    const { rn } = grid({ speedProfileRatio: null });
    const start = rn.findNearestNode(west);
    const end = rn.findNearestNode(east);
    const before = ids(rn.findRoute(start, end));
    const slow = edgeBetween(rn, west, centre);
    expect(rn.setSpeedOverrides(table([[rn.edgeIndexOf(slow), 1]]))).toBe(false);
    expect(rn.learnedSpeedKmh(slow)).toBeUndefined();
    expect(ids(rn.findRoute(start, end))).toEqual(before);
  });

  it("reaches the worker pool, both before and after the pool starts", async () => {
    const { rn } = grid({ speedProfileRatio: 1 });
    const start = rn.findNearestNode(west);
    const end = rn.findNearestNode(east);
    const slow = edgeBetween(rn, west, centre);
    try {
      // Table applied before the lazily-created pool exists: replayed on start.
      rn.setSpeedOverrides(table([[rn.edgeIndexOf(slow), 1]]));
      expect(ids(await rn.findRouteAsync(start, end))).not.toContain(slow.id);
      // Table replaced while the pool runs: later requests see it (and skip the cache).
      rn.setSpeedOverrides(table([]));
      expect(ids(await rn.findRouteAsync(start, end))).toContain(slow.id);
      rn.setSpeedOverrides(table([[rn.edgeIndexOf(slow), 1]]));
      expect(ids(await rn.findRouteAsync(start, end))).toEqual(ids(rn.findRoute(start, end)));
    } finally {
      await rn.shutdownWorkers();
    }
  });

  it("bumps the profile version on every applied table", () => {
    const { rn } = grid({ speedProfileRatio: 1 });
    const v0 = rn.speedProfileVersion;
    rn.setSpeedOverrides(table([]));
    expect(rn.speedProfileVersion).toBe(v0 + 1);
  });
});

describe("learned speeds keep ALT admissible and main/worker equivalent", () => {
  /** Deterministic PRNG. */
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Random slow and (clamped) fast overrides over a third of the edges. */
  function randomTable(rn: RoadNetwork, seed: number) {
    const rand = mulberry32(seed);
    const entries: Array<[number, number]> = [];
    for (let i = 0; i < rn.edgeCount; i++) {
      if (rand() < 0.33) entries.push([i, rand() < 0.5 ? 1 + rand() * 10 : 50 + rand() * 200]);
    }
    return table(entries);
  }

  function pathCost(rn: RoadNetwork, route: Route): number {
    let hours = 0;
    route.edges.forEach((edge, i) => {
      const learned = rn.learnedSpeedKmh(edge);
      // @ts-expect-error — private engine state, read to price the path as the search does.
      const base = rn.pathfinding.edgeBaseCost.get(edge.id)!;
      hours += learned !== undefined ? edge.distance / learned : base;
      hours += edge.nodeDelayH ?? 0;
      if (i > 0) hours += rn.turnCostHours(route.edges[i - 1], edge);
    });
    return hours;
  }

  it("finds equally cheap routes with and without landmarks under learned speeds", () => {
    for (const ratio of [1, 1.5]) {
      const withAlt = new RoadNetwork(integrationFixture, {
        landmarkCount: 4,
        speedProfileRatio: ratio,
      });
      const noAlt = new RoadNetwork(integrationFixture, {
        landmarkCount: 0,
        speedProfileRatio: ratio,
      });
      const t = randomTable(withAlt, 7);
      withAlt.setSpeedOverrides(t);
      noAlt.setSpeedOverrides(t);
      // @ts-expect-error — private graph, as the other RoadNetwork tests do.
      const nodes = [...(withAlt.nodes as Map<string, Node>).values()];
      let compared = 0;
      for (let i = 0; i < nodes.length; i += 3) {
        for (let j = 1; j < nodes.length; j += 5) {
          if (i === j) continue;
          const a = withAlt.findRoute(nodes[i], nodes[j]);
          const b = noAlt.findRoute(
            noAlt.findNearestNode(nodes[i].coordinates),
            noAlt.findNearestNode(nodes[j].coordinates)
          );
          expect(Boolean(a)).toBe(Boolean(b));
          if (a && b) {
            expect(pathCost(withAlt, a)).toBeCloseTo(pathCost(noAlt, b), 9);
            compared++;
          }
        }
      }
      expect(compared).toBeGreaterThan(10);
    }
  });

  it("never lets the landmark heuristic exceed a true cost priced at learned speeds", () => {
    const ratio = 2;
    const rn = new RoadNetwork(integrationFixture, { landmarkCount: 4, speedProfileRatio: ratio });
    // Every edge learned as fast as the clamp allows: the cheapest the graph can get.
    rn.setSpeedOverrides(
      table(Array.from({ length: rn.edgeCount }, (_, i): [number, number] => [i, 10_000]))
    );
    // @ts-expect-error — private engine, to read the heuristic the search uses.
    const engine = rn.pathfinding as {
      alt: { setTarget(i: number | undefined): boolean };
      altActive: boolean;
      calculateHeuristic(a: Node, b: Node): number;
    };
    // @ts-expect-error — private graph.
    const nodes = [...(rn.nodes as Map<string, Node>).values()];
    let checked = 0;
    for (let i = 0; i < nodes.length; i += 2) {
      for (let j = 1; j < nodes.length; j += 3) {
        if (i === j) continue;
        const route = rn.findRoute(nodes[i], nodes[j]);
        if (!route || route.edges.length === 0) continue;
        engine.altActive = engine.alt.setTarget(
          (nodes[j] as Node & { altIndex?: number }).altIndex
        );
        const h = engine.calculateHeuristic(nodes[i], nodes[j]);
        expect(h).toBeLessThanOrEqual(pathCost(rn, route) + 1e-12);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("returns identical routes on the main thread and in the worker", () => {
    const ratio = 1.25;
    const rn = new RoadNetwork(integrationFixture, { landmarkCount: 4, speedProfileRatio: ratio });
    const workerNodes = buildGraph(integrationFixture, 4, undefined, undefined, ratio);
    const t = randomTable(rn, 11);
    rn.setSpeedOverrides(t);
    workerApplySpeedOverrides(workerNodes, t);

    const nodeIds = [...workerNodes.keys()];
    let compared = 0;
    for (let i = 0; i < nodeIds.length; i += 2) {
      for (let j = 1; j < nodeIds.length; j += 3) {
        if (i === j) continue;
        const [la, lo] = nodeIds[i].split(",").map(Number);
        const [lb, lob] = nodeIds[j].split(",").map(Number);
        const main = rn.findRoute(rn.findNearestNode([la, lo]), rn.findNearestNode([lb, lob]));
        const worker = workerFindRoute(workerNodes, nodeIds[i], nodeIds[j]);
        expect(ids(main)).toEqual(worker ? worker.edgeIds : null);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10);

    // Replacing the table restores untouched edges to their static cost on both sides.
    rn.setSpeedOverrides(table([]));
    workerApplySpeedOverrides(workerNodes, table([]));
    const plain = new RoadNetwork(integrationFixture, {
      landmarkCount: 4,
      speedProfileRatio: ratio,
    });
    for (let i = 0; i < nodeIds.length; i += 4) {
      const [la, lo] = nodeIds[i].split(",").map(Number);
      const [lb, lob] = nodeIds[nodeIds.length - 1 - i].split(",").map(Number);
      const a = rn.findRoute(rn.findNearestNode([la, lo]), rn.findNearestNode([lb, lob]));
      const b = plain.findRoute(plain.findNearestNode([la, lo]), plain.findNearestNode([lb, lob]));
      const w = workerFindRoute(workerNodes, nodeIds[i], nodeIds[nodeIds.length - 1 - i]);
      expect(ids(a)).toEqual(ids(b));
      expect(ids(a)).toEqual(w ? w.edgeIds : null);
    }
  });
});

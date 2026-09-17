import { describe, it, expect, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { MIN_WEATHER_FACTOR } from "../../modules/pathfinding/cost";
import {
  buildGraph,
  findRoute as workerFindRoute,
  applyWeatherFactor as workerApplyWeatherFactor,
} from "../../workers/pathfinding-worker";
import type { Node, Route } from "../../types";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

// Global weather speed factor applied to routing cost / ALT admissibility
// (fleetsim-all-1ajn.5). Uses the same 3x3 grid fixture as
// speedprofiles/speedProfileRouting.test.ts.

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

const integrationFixture = path.join(__dirname, "..", "fixtures", "integration-network.geojson");

function grid(options: { landmarkCount?: number } = {}) {
  const file = writeTmpNetwork(gridFeatures());
  tmpFiles.push(file);
  return { file, rn: new RoadNetwork(file, { landmarkCount: options.landmarkCount ?? 2 }) };
}

const ids = (r: Route | null) => (r ? r.edges.map((e) => e.id) : null);

describe("RoadNetwork.setWeatherFactor / getWeatherFactor", () => {
  it("defaults to 1 (no effect)", () => {
    const { rn } = grid();
    expect(rn.getWeatherFactor()).toBe(1);
  });

  it("clamps to (0, 1]: never a discount, never at/below 0", () => {
    const { rn } = grid();
    rn.setWeatherFactor(1.5);
    expect(rn.getWeatherFactor()).toBe(1);
    rn.setWeatherFactor(0);
    expect(rn.getWeatherFactor()).toBe(MIN_WEATHER_FACTOR);
    rn.setWeatherFactor(-3);
    expect(rn.getWeatherFactor()).toBe(MIN_WEATHER_FACTOR);
    rn.setWeatherFactor(0.6);
    expect(rn.getWeatherFactor()).toBe(0.6);
  });

  it("invalidates the route cache when the factor changes (part of costFingerprint)", () => {
    const { rn } = grid();
    const west = rn.findNearestNode(gridPos(1, 0));
    const east = rn.findNearestNode(gridPos(1, 2));

    rn.findRoute(west, east);
    rn.findRoute(west, east); // served from cache
    expect(rn.routeCacheStats().hits).toBe(1);

    rn.setWeatherFactor(0.5);
    rn.findRoute(west, east); // new fingerprint -> miss, not served from the old cache
    expect(rn.routeCacheStats().misses).toBe(2);

    rn.findRoute(west, east); // now cached under the new fingerprint
    expect(rn.routeCacheStats().hits).toBe(2);
  });

  it("keys the route cache on the exact factor, not a rounded one", () => {
    // Weather scales travel time but not node delays / turn costs, so even a
    // small change can change the optimal route; a rounded key would serve it stale.
    const { rn } = grid();
    const west = rn.findNearestNode(gridPos(1, 0));
    const east = rn.findNearestNode(gridPos(1, 2));
    rn.setWeatherFactor(0.501);
    rn.findRoute(west, east);
    rn.setWeatherFactor(0.504);
    rn.findRoute(west, east);
    expect(rn.routeCacheStats().hits).toBe(0);
  });

  it("does not change which route is chosen (a uniform factor scales every edge equally)", () => {
    const { rn } = grid();
    const west = rn.findNearestNode(gridPos(1, 0));
    const east = rn.findNearestNode(gridPos(1, 2));
    const before = ids(rn.findRoute(west, east));

    rn.setWeatherFactor(0.3);
    const after = ids(rn.findRoute(west, east));

    expect(after).toEqual(before);
  });

  it("reaches the worker pool, both before and after the pool starts", async () => {
    const { rn } = grid();
    const west = rn.findNearestNode(gridPos(1, 0));
    const east = rn.findNearestNode(gridPos(1, 2));
    try {
      // Set before the lazily-created pool exists: replayed on start.
      rn.setWeatherFactor(0.5);
      const before = ids(await rn.findRouteAsync(west, east));
      expect(before).toEqual(ids(rn.findRoute(west, east)));

      // Changed while the pool is already running: later requests see it.
      rn.setWeatherFactor(0.2);
      const after = ids(await rn.findRouteAsync(west, east));
      expect(after).toEqual(ids(rn.findRoute(west, east)));
    } finally {
      await rn.shutdownWorkers();
    }
  });
});

describe("weather keeps ALT admissible and main/worker equivalent", () => {
  afterEach(() => {
    // Module-level worker state persists across graphs built in-process
    // (mirrors _driveSide/_speedProfileRatio) — reset between tests.
    workerApplyWeatherFactor(1);
  });

  function pathCost(rn: RoadNetwork, route: Route): number {
    let hours = 0;
    const weatherFactor = rn.getWeatherFactor();
    route.edges.forEach((edge, i) => {
      // @ts-expect-error — private engine state, read to price the path as the search does.
      const base = rn.pathfinding.edgeBaseCost.get(edge.id)!;
      hours += weatherFactor < 1 ? base / weatherFactor : base;
      hours += edge.nodeDelayH ?? 0;
      if (i > 0) hours += rn.turnCostHours(route.edges[i - 1], edge);
    });
    return hours;
  }

  it("never lets the landmark heuristic exceed a true cost priced under a low weather factor", () => {
    const rn = new RoadNetwork(integrationFixture, { landmarkCount: 4 });
    rn.setWeatherFactor(0.4);
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
        expect(h).toBeLessThanOrEqual(pathCost(rn, route) + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("returns identical routes on the main thread and in the worker under the same weather factor", () => {
    const rn = new RoadNetwork(integrationFixture, { landmarkCount: 4 });
    rn.setWeatherFactor(0.6);
    const workerNodes = buildGraph(integrationFixture, 4);
    workerApplyWeatherFactor(0.6);

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
  });

  it("restores static costs on both sides when the factor is reset to 1", () => {
    const rn = new RoadNetwork(integrationFixture, { landmarkCount: 4 });
    const workerNodes = buildGraph(integrationFixture, 4);

    rn.setWeatherFactor(0.5);
    workerApplyWeatherFactor(0.5);
    rn.setWeatherFactor(1);
    workerApplyWeatherFactor(1);

    const plain = new RoadNetwork(integrationFixture, { landmarkCount: 4 });
    const nodeIds = [...workerNodes.keys()];
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

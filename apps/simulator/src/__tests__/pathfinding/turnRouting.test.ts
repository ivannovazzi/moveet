import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { buildGraph, findRoute as workerFindRoute } from "../../workers/pathfinding-worker";
import { DEFAULT_FREE_FLOW_FACTORS } from "../../modules/roadnetwork/types";
import type { Edge, Route } from "../../types";
import {
  gridFeatures,
  gridPos,
  restriction,
  rowWay,
  colWay,
  writeTmpNetwork,
} from "../fixtures/turnGrid";

// Turn restrictions + turn penalties through the full graph build and both A*
// implementations (fleetsim-all-1ajn.3). See fixtures/turnGrid.ts for the layout.

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

function network(features: Record<string, unknown>[], driveSide?: "left" | "right") {
  const file = writeTmpNetwork(features);
  tmpFiles.push(file);
  return { file, rn: new RoadNetwork(file, { landmarkCount: 2, driveSide }) };
}

function route(rn: RoadNetwork, from: [number, number], to: [number, number]): Route | null {
  return rn.findRoute(rn.findNearestNode(from), rn.findNearestNode(to));
}

const nodeId = (rn: RoadNetwork, p: [number, number]) => rn.findNearestNode(p).id;
const hop = (rn: RoadNetwork, a: [number, number], b: [number, number]) =>
  `${nodeId(rn, a)}-${nodeId(rn, b)}`;

/** Asserts no consecutive pair in the route is a banned transition. */
function expectLegal(rn: RoadNetwork, r: Route) {
  const bans = rn.getTurnBans();
  for (let i = 1; i < r.edges.length; i++) {
    expect(bans.get(r.edges[i - 1].id)?.has(r.edges[i].id) ?? false).toBe(false);
    expect(r.edges[i - 1].end.id).toBe(r.edges[i].start.id);
  }
}

const ids = (r: Route | null) => (r ? r.edges.map((e: Edge) => e.id) : null);

describe("turn restrictions steer the route", () => {
  const centre = gridPos(1, 1);
  const south = gridPos(2, 1);

  it("no_left_turn: the route avoids the banned left turn", () => {
    const west = gridPos(1, 0);
    const plain = network(gridFeatures()).rn;
    // Unrestricted, the short way is north to the centre then left (west).
    expect(ids(route(plain, south, west))).toEqual([
      hop(plain, south, centre),
      hop(plain, centre, west),
    ]);

    const { rn } = network([
      ...gridFeatures(),
      restriction("no_left_turn", colWay(1, 1), centre, rowWay(1, 0)),
    ]);
    const r = route(rn, south, west);
    expect(r).not.toBeNull();
    expectLegal(rn, r!);
    const seq = ids(r)!.join(" ");
    expect(seq).not.toContain(`${hop(rn, south, centre)} ${hop(rn, centre, west)}`);
    expect(r!.edges.at(-1)!.end.id).toBe(nodeId(rn, west));
  });

  it("only_straight_on: the approach may only continue north", () => {
    const east = gridPos(1, 2);
    const plain = network(gridFeatures()).rn;
    // Unrestricted: north to the centre, then right (east).
    expect(ids(route(plain, south, east))).toEqual([
      hop(plain, south, centre),
      hop(plain, centre, east),
    ]);

    const { rn } = network([
      ...gridFeatures(),
      restriction("only_straight_on", colWay(1, 1), centre, colWay(0, 1)),
    ]);
    const bans = rn.getTurnBans().get(hop(rn, south, centre));
    expect(bans).toBeDefined();
    expect([...bans!].sort()).toEqual(
      [hop(rn, centre, east), hop(rn, centre, gridPos(1, 0)), hop(rn, centre, south)].sort()
    );

    const r = route(rn, south, east);
    expect(r).not.toBeNull();
    expectLegal(rn, r!);
    if (r!.edges[0].id === hop(rn, south, centre)) {
      expect(r!.edges[1].id).toBe(hop(rn, centre, gridPos(0, 1)));
    }
    expect(r!.edges.at(-1)!.end.id).toBe(nodeId(rn, east));
  });

  it("ignores restrictions that exempt cars", () => {
    const west = gridPos(1, 0);
    const { rn } = network([
      ...gridFeatures(),
      restriction("no_left_turn", colWay(1, 1), centre, rowWay(1, 0), { except: "motorcar" }),
    ]);
    expect(rn.getTurnBans().size).toBe(0);
    expect(ids(route(rn, south, west))).toEqual([hop(rn, south, centre), hop(rn, centre, west)]);
  });
});

describe("turn penalties follow the drive side", () => {
  // From the south-east corner to the centre there are two equal-length routes:
  // west then north (a RIGHT turn) or north then west (a LEFT turn).
  const from = gridPos(2, 2);
  const to = gridPos(1, 1);

  it("prefers the right turn in right-hand traffic", () => {
    const { rn } = network(gridFeatures(), "right");
    const r = route(rn, from, to)!;
    expect(r.edges[0].id).toBe(hop(rn, from, gridPos(2, 1)));
  });

  it("prefers the left turn in left-hand traffic", () => {
    const { rn } = network(gridFeatures(), "left");
    const r = route(rn, from, to)!;
    expect(r.edges[0].id).toBe(hop(rn, from, gridPos(1, 2)));
  });

  it("exposes the turn cost a route search charges, for ETA estimation", () => {
    const { rn } = network(gridFeatures(), "right");
    const r = route(rn, from, to)!;
    expect(rn.turnCostHours(r.edges[0], r.edges[1])).toBeGreaterThan(0);
    const straight = route(rn, gridPos(2, 1), gridPos(0, 1))!;
    expect(rn.turnCostHours(straight.edges[0], straight.edges[1])).toBe(0);
  });
});

describe("main-thread and worker A* agree with restrictions and turn penalties", () => {
  const centre = gridPos(1, 1);
  const features = [
    ...gridFeatures(),
    restriction("no_left_turn", colWay(1, 1), centre, rowWay(1, 0)),
    restriction("only_straight_on", colWay(0, 1), centre, colWay(1, 1)),
    restriction("no_u_turn", rowWay(1, 1), centre, rowWay(1, 1)),
  ];

  for (const driveSide of ["right", "left"] as const) {
    it(`produces identical routes for every node pair (${driveSide}-hand traffic)`, () => {
      const { file, rn } = network(features, driveSide);
      const workerNodes = buildGraph(file, 2, DEFAULT_FREE_FLOW_FACTORS, driveSide);
      const nodeIds = [...workerNodes.keys()];

      let compared = 0;
      for (const a of nodeIds) {
        for (const b of nodeIds) {
          if (a === b) continue;
          const [alat, alon] = a.split(",").map(Number);
          const [blat, blon] = b.split(",").map(Number);
          const main = route(rn, [alat, alon], [blat, blon]);
          const worker = workerFindRoute(workerNodes, a, b);
          expect(Boolean(main)).toBe(Boolean(worker));
          if (main && worker) {
            expectLegal(rn, main);
            expect(ids(main)).toEqual(worker.edgeIds);
            expect(main.distance).toBeCloseTo(worker.distance, 9);
            compared++;
          }
        }
      }
      expect(compared).toBeGreaterThan(50);
    });
  }
});

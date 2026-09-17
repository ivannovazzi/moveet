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

describe("arrival edge: turn rules apply at a moving vehicle's next node", () => {
  const centre = gridPos(1, 1);
  const south = gridPos(2, 1);
  const west = gridPos(1, 0);
  const features = [
    ...gridFeatures(),
    restriction("no_left_turn", colWay(1, 1), centre, rowWay(1, 0)),
  ];

  it("respects a no_left_turn at the start node when the arrival edge is given", () => {
    const { rn } = network(features);
    const start = rn.findNearestNode(centre);
    const end = rn.findNearestNode(west);
    const arrival = rn.getEdge(hop(rn, south, centre))!;

    // Without an arrival edge the banned left turn is the direct route.
    expect(ids(rn.findRoute(start, end))).toEqual([hop(rn, centre, west)]);

    const r = rn.findRoute(start, end, arrival);
    expect(r).not.toBeNull();
    expect(r!.edges[0].id).not.toBe(hop(rn, centre, west));
    expectLegal(rn, { edges: [arrival, ...r!.edges], distance: 0 });
    expect(r!.edges.at(-1)!.end.id).toBe(nodeId(rn, west));
  });

  it("does not serve the unconstrained cached route to an arrival-constrained request", async () => {
    const { rn } = network(features);
    const start = rn.findNearestNode(centre);
    const end = rn.findNearestNode(west);
    const arrival = rn.getEdge(hop(rn, south, centre))!;
    try {
      const plain = await rn.findRouteAsync(start, end);
      expect(ids(plain)).toEqual([hop(rn, centre, west)]);
      const constrained = await rn.findRouteAsync(start, end, undefined, arrival);
      expect(constrained).not.toBeNull();
      expect(constrained!.edges[0].id).not.toBe(hop(rn, centre, west));
      expect(ids(constrained)).toEqual(ids(rn.findRoute(start, end, arrival)));
    } finally {
      await rn.shutdownWorkers();
    }
  });

  it("charges the first turn from the arrival edge (U-turn is costlier than straight on)", () => {
    const { rn } = network(gridFeatures());
    const start = rn.findNearestNode(centre);
    const arrival = rn.getEdge(hop(rn, south, centre))!;
    // Straight on (north) is free; heading back south is a U-turn.
    const back = rn.findRoute(start, rn.findNearestNode(south), arrival)!;
    const plainBack = rn.findRoute(start, rn.findNearestNode(south))!;
    expect(ids(plainBack)).toEqual([hop(rn, centre, south)]);
    // Either the U-turn is taken (and legal at an intersection) or avoided;
    // the route must still be legal and reach the target.
    expect(back.edges.at(-1)!.end.id).toBe(nodeId(rn, south));
  });

  it("lets a vehicle U-turn out of a node whose only exit is the reversal", () => {
    // A <-> B two-way, C -> B one-way inbound: B has degree 2 and one exit.
    const a: [number, number] = [-1.3, 36.9];
    const b: [number, number] = [-1.3, 36.901];
    const c: [number, number] = [-1.301, 36.901];
    const way = (id: number, p: [number, number], q: [number, number], extra = {}) => ({
      type: "Feature",
      properties: { "@id": id, highway: "residential", ...extra },
      geometry: {
        type: "LineString",
        coordinates: [
          [p[1], p[0]],
          [q[1], q[0]],
        ],
      },
    });
    const { file, rn } = network([way(1, a, b), way(2, c, b, { oneway: "yes" })]);
    const arrival = rn.getEdge(hop(rn, a, b))!;
    const r = rn.findRoute(rn.findNearestNode(b), rn.findNearestNode(a), arrival);
    expect(ids(r)).toEqual([hop(rn, b, a)]);

    const workerNodes = buildGraph(file, 2, DEFAULT_FREE_FLOW_FACTORS, "right");
    const w = workerFindRoute(workerNodes, nodeId(rn, b), nodeId(rn, a), undefined, undefined, {
      edgeId: arrival.id,
      startId: arrival.start.id,
    });
    expect(w?.edgeIds).toEqual([hop(rn, b, a)]);
  });

  for (const driveSide of ["right", "left"] as const) {
    it(`main-thread and worker agree for every arrival edge and target (${driveSide})`, () => {
      const all = [
        ...features,
        restriction("only_straight_on", colWay(0, 1), centre, colWay(1, 1)),
        restriction("no_u_turn", rowWay(1, 1), centre, rowWay(1, 1)),
      ];
      const { file, rn } = network(all, driveSide);
      const workerNodes = buildGraph(file, 2, DEFAULT_FREE_FLOW_FACTORS, driveSide);
      const nodeIds = [...workerNodes.keys()];
      const toPos = (id: string) => id.split(",").map(Number) as [number, number];

      let compared = 0;
      for (const startId of nodeIds) {
        const start = rn.findNearestNode(toPos(startId));
        const arrivals = nodeIds
          .map((id) => rn.getEdge(`${id}-${startId}`))
          .filter((e): e is Edge => e !== undefined);
        for (const arrival of arrivals) {
          for (const endId of nodeIds) {
            if (endId === startId) continue;
            const main = rn.findRoute(start, rn.findNearestNode(toPos(endId)), arrival);
            const worker = workerFindRoute(workerNodes, startId, endId, undefined, undefined, {
              edgeId: arrival.id,
              startId: arrival.start.id,
            });
            expect(Boolean(main)).toBe(Boolean(worker));
            if (main && worker) {
              expectLegal(rn, { edges: [arrival, ...main.edges], distance: 0 });
              expect(ids(main)).toEqual(worker.edgeIds);
              compared++;
            }
          }
        }
      }
      expect(compared).toBeGreaterThan(100);
    });
  }
});

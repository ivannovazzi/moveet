import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Feature, FeatureCollection } from "geojson";
import { GraphBuilder } from "../modules/roadnetwork/GraphBuilder";
import { buildGraph } from "../workers/pathfinding-worker";
import { computeNodeDelayS, nodeDelayHours } from "../modules/pathfinding/cost";
import { MAX_CONTROL_SNAP_KM, parseNodeControls } from "../modules/roadnetwork/types";

/**
 * fleetsim-all-1ajn.2: typed per-node delays replacing the flat 45s
 * `SIGNAL_DELAY_S` boolean. Covers tag parsing, GraphBuilder/worker
 * precomputation (must match — worker/main equivalence), and the way-level
 * traffic-calming speed cap.
 */

// GeoJSON coordinates are [lon, lat]; `Node.coordinates` (below) is [lat, lon].
const LAT = 45.501;
const LON_A = -73.567;
const LON_B = -73.566;
const LON_C = -73.565;

function lineString(
  id: string,
  lons: [number, number, number],
  props: Record<string, unknown> = {}
): Feature {
  return {
    type: "Feature",
    properties: { id, name: id, highway: "primary", ...props },
    geometry: {
      type: "LineString",
      coordinates: lons.map((lon) => [lon, LAT]) as [number, number][],
    },
  };
}

function pointAtB(id: string, props: Record<string, unknown>): Feature {
  return {
    type: "Feature",
    properties: { id, ...props },
    geometry: { type: "Point", coordinates: [LON_B, LAT] },
  };
}

/** A→B→C, all on one road; the Point sits at B, shared by both edges. */
function networkWithPointAtB(
  pointProps: Record<string, unknown>,
  wayProps: Record<string, unknown> = {}
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [lineString("r1", [LON_A, LON_B, LON_C], wayProps), pointAtB("p1", pointProps)],
  };
}

type BuiltNetwork = ReturnType<GraphBuilder["build"]>;

/** The A→B edge — the one edge whose END node (B) carries the point's control. */
function edgeIntoB(built: BuiltNetwork) {
  const edge = [...built.edges.values()].find(
    (e) => e.end.coordinates[0] === LAT && e.end.coordinates[1] === LON_B
  );
  if (!edge) throw new Error("no edge found ending at B");
  return edge;
}

describe("parseNodeControls", () => {
  it("parses a traffic_signals node, defaulting direction to both", () => {
    expect(parseNodeControls({ highway: "traffic_signals" })).toEqual([
      { kind: "traffic_signals", direction: "both" },
    ]);
  });

  it("captures traffic_signals:direction when present", () => {
    expect(
      parseNodeControls({ highway: "traffic_signals", "traffic_signals:direction": "forward" })
    ).toEqual([{ kind: "traffic_signals", direction: "forward" }]);
  });

  it("parses stop and give_way", () => {
    expect(parseNodeControls({ highway: "stop" })).toEqual([{ kind: "stop" }]);
    expect(parseNodeControls({ highway: "give_way" })).toEqual([{ kind: "give_way" }]);
  });

  it("captures the crossing= subtype", () => {
    expect(parseNodeControls({ highway: "crossing", crossing: "marked" })).toEqual([
      { kind: "crossing", subtype: "marked" },
    ]);
    expect(parseNodeControls({ highway: "crossing" })).toEqual([
      { kind: "crossing", subtype: undefined },
    ]);
  });

  it("parses railway=level_crossing", () => {
    expect(parseNodeControls({ railway: "level_crossing" })).toEqual([{ kind: "level_crossing" }]);
  });

  it("parses traffic_calming, skipping the explicit 'no' value", () => {
    expect(parseNodeControls({ traffic_calming: "bump" })).toEqual([
      { kind: "traffic_calming", subtype: "bump" },
    ]);
    expect(parseNodeControls({ traffic_calming: "no" })).toEqual([]);
  });

  it("splits a compound highway=a;b value into multiple controls", () => {
    const controls = parseNodeControls({ highway: "traffic_signals;crossing", crossing: "marked" });
    expect(controls).toEqual(
      expect.arrayContaining([
        { kind: "traffic_signals", direction: "both" },
        { kind: "crossing", subtype: "marked" },
      ])
    );
    expect(controls).toHaveLength(2);
  });

  it("returns an empty array for a node with no relevant tags", () => {
    expect(parseNodeControls({ amenity: "cafe" })).toEqual([]);
  });
});

describe("GraphBuilder precomputes edge.nodeDelayH from point features", () => {
  it("sets nodeDelayH on edges ending at a traffic_signals node, matching computeNodeDelayS", () => {
    const built = new GraphBuilder().build(networkWithPointAtB({ highway: "traffic_signals" }));
    const edge = edgeIntoB(built);
    const expected = nodeDelayHours({ kind: "traffic_signals", direction: "both" }, edge.highway);
    expect(edge.nodeDelayH).toBeCloseTo(expected, 12);
    expect(edge.nodeDelayH).toBeGreaterThan(0);
  });

  it("leaves nodeDelayH unset on edges with no control at their end node", () => {
    const built = new GraphBuilder().build({
      type: "FeatureCollection",
      features: [lineString("r1", [LON_A, LON_B, LON_C])],
    });
    for (const edge of built.edges.values()) {
      expect(edge.nodeDelayH).toBeUndefined();
    }
  });

  it("sets a fixed stop delay regardless of approach class", () => {
    const built = new GraphBuilder().build(networkWithPointAtB({ highway: "stop" }));
    const edge = edgeIntoB(built);
    expect(edge.nodeDelayH).toBeCloseTo(computeNodeDelayS({ kind: "stop" }, "primary") / 3600, 12);
  });

  it("gives give-way a smaller delay than a full stop", () => {
    const stop = edgeIntoB(new GraphBuilder().build(networkWithPointAtB({ highway: "stop" })));
    const giveWay = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ highway: "give_way" }))
    );
    expect(giveWay.nodeDelayH).toBeLessThan(stop.nodeDelayH!);
  });

  it("scales crossing delay by crossing= subtype", () => {
    const signalCrossing = edgeIntoB(
      new GraphBuilder().build(
        networkWithPointAtB({ highway: "crossing", crossing: "traffic_signals" })
      )
    );
    const unmarkedCrossing = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ highway: "crossing", crossing: "unmarked" }))
    );
    expect(signalCrossing.nodeDelayH).toBeGreaterThan(unmarkedCrossing.nodeDelayH!);
  });

  it("sets a level-crossing delay for railway=level_crossing", () => {
    const edge = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ railway: "level_crossing" }))
    );
    expect(edge.nodeDelayH).toBeCloseTo(
      computeNodeDelayS({ kind: "level_crossing" }, "primary") / 3600,
      12
    );
  });

  it("sets a point traffic_calming delay but skips traffic_calming=no", () => {
    const bump = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ traffic_calming: "bump" }))
    );
    const no = edgeIntoB(new GraphBuilder().build(networkWithPointAtB({ traffic_calming: "no" })));
    expect(bump.nodeDelayH).toBeGreaterThan(0);
    expect(no.nodeDelayH).toBeUndefined();
  });

  it("resolves a compound highway=traffic_signals;crossing node to the higher-priority signal delay", () => {
    const compound = edgeIntoB(
      new GraphBuilder().build(
        networkWithPointAtB({ highway: "traffic_signals;crossing", crossing: "marked" })
      )
    );
    const signalOnly = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ highway: "traffic_signals" }))
    );
    expect(compound.nodeDelayH).toBeCloseTo(signalOnly.nodeDelayH!, 12);
  });

  it("halves the signal delay for a one-directional traffic_signals:direction", () => {
    const both = edgeIntoB(
      new GraphBuilder().build(networkWithPointAtB({ highway: "traffic_signals" }))
    );
    const forward = edgeIntoB(
      new GraphBuilder().build(
        networkWithPointAtB({ highway: "traffic_signals", "traffic_signals:direction": "forward" })
      )
    );
    expect(forward.nodeDelayH).toBeCloseTo(both.nodeDelayH! / 2, 12);
  });

  it("gives a major-road approach a smaller signal delay than a minor-road approach", () => {
    const major = edgeIntoB(
      new GraphBuilder().build(
        networkWithPointAtB({ highway: "traffic_signals" }, { highway: "primary" })
      )
    );
    const minor = edgeIntoB(
      new GraphBuilder().build(
        networkWithPointAtB({ highway: "traffic_signals" }, { highway: "residential" })
      )
    );
    expect(major.nodeDelayH).toBeLessThan(minor.nodeDelayH!);
  });
});

describe("way-level traffic_calming caps freeFlowSpeed instead of adding a node delay", () => {
  it("caps the edge's freeFlowSpeed to TRAFFIC_CALMING_MAX_SPEED_KMH", () => {
    const calmed = new GraphBuilder().build({
      type: "FeatureCollection",
      features: [
        lineString("r1", [LON_A, LON_B, LON_C], {
          highway: "primary",
          maxspeed: "80",
          traffic_calming: "table",
        }),
      ],
    });
    const plain = new GraphBuilder().build({
      type: "FeatureCollection",
      features: [lineString("r1", [LON_A, LON_B, LON_C], { highway: "primary", maxspeed: "80" })],
    });
    for (const edge of calmed.edges.values()) {
      expect(edge.freeFlowSpeed).toBeLessThanOrEqual(25);
      expect(edge.nodeDelayH).toBeUndefined();
    }
    // Sanity: without the tag, free-flow speed is well above the calmed cap.
    for (const edge of plain.edges.values()) {
      expect(edge.freeFlowSpeed).toBeGreaterThan(25);
    }
  });

  it("does not cap when traffic_calming=no", () => {
    const built = new GraphBuilder().build({
      type: "FeatureCollection",
      features: [
        lineString("r1", [LON_A, LON_B, LON_C], {
          highway: "primary",
          maxspeed: "80",
          traffic_calming: "no",
        }),
      ],
    });
    for (const edge of built.edges.values()) {
      expect(edge.freeFlowSpeed).toBeGreaterThan(25);
    }
  });
});

describe("control points snap to a node only within MAX_CONTROL_SNAP_KM", () => {
  function withPoint(lat: number, lon: number): FeatureCollection {
    return {
      type: "FeatureCollection",
      features: [
        lineString("r1", [LON_A, LON_B, LON_C]),
        {
          type: "Feature",
          properties: { id: "p1", highway: "stop" },
          geometry: { type: "Point", coordinates: [lon, lat] },
        },
      ],
    };
  }

  const cases = [
    // ~4 m east of B: a slightly offset tag still lands on B.
    { name: "a nearby point", fc: withPoint(LAT, LON_B + 0.00005), delayed: true },
    // ~220 m north of B: a control on a road that is not in the graph.
    { name: "a far-away point", fc: withPoint(LAT + 0.002, LON_B), delayed: false },
  ];

  for (const { name, fc, delayed } of cases) {
    it(`${delayed ? "attaches" : "drops"} ${name} (main thread and worker)`, () => {
      expect(MAX_CONTROL_SNAP_KM).toBeGreaterThanOrEqual(0.015);
      expect(MAX_CONTROL_SNAP_KM).toBeLessThanOrEqual(0.02);
      const built = new GraphBuilder().build(fc);
      const delayedEdges = [...built.edges.values()].filter((e) => (e.nodeDelayH ?? 0) > 0);
      expect(delayedEdges.length > 0).toBe(delayed);

      const tmpPath = writeTempGeojson(fc);
      try {
        const workerNodes = buildGraph(tmpPath);
        const workerDelayed = [...workerNodes.values()]
          .flatMap((n) => n.edges)
          .filter((e) => e.nodeDelayH > 0);
        expect(workerDelayed.length > 0).toBe(delayed);
      } finally {
        cleanupTempGeojson(tmpPath);
      }
    });
  }
});

describe("worker buildGraph matches GraphBuilder's node-delay precomputation", () => {
  const scenarios: Array<{ name: string; fc: FeatureCollection }> = [
    { name: "traffic_signals", fc: networkWithPointAtB({ highway: "traffic_signals" }) },
    {
      name: "traffic_signals:direction=forward",
      fc: networkWithPointAtB({
        highway: "traffic_signals",
        "traffic_signals:direction": "forward",
      }),
    },
    { name: "stop", fc: networkWithPointAtB({ highway: "stop" }) },
    { name: "give_way", fc: networkWithPointAtB({ highway: "give_way" }) },
    {
      name: "crossing marked",
      fc: networkWithPointAtB({ highway: "crossing", crossing: "marked" }),
    },
    {
      name: "crossing traffic_signals",
      fc: networkWithPointAtB({ highway: "crossing", crossing: "traffic_signals" }),
    },
    { name: "level_crossing", fc: networkWithPointAtB({ railway: "level_crossing" }) },
    {
      name: "traffic_calming point (table)",
      fc: networkWithPointAtB({ traffic_calming: "table" }),
    },
    {
      name: "no control",
      fc: { type: "FeatureCollection", features: [lineString("r1", [LON_A, LON_B, LON_C])] },
    },
  ];

  for (const { name, fc } of scenarios) {
    it(`agrees on nodeDelayH for every edge — ${name}`, () => {
      const mainBuilt = new GraphBuilder().build(fc);
      const tmpPath = writeTempGeojson(fc);
      try {
        const workerNodes = buildGraph(tmpPath);
        for (const edge of mainBuilt.edges.values()) {
          const startWorkerNode = workerNodes.get(edge.start.id);
          expect(startWorkerNode).toBeDefined();
          const workerEdge = startWorkerNode!.edges.find((e) => e.id === edge.id);
          expect(workerEdge).toBeDefined();
          expect(workerEdge!.nodeDelayH).toBeCloseTo(edge.nodeDelayH ?? 0, 12);
        }
      } finally {
        cleanupTempGeojson(tmpPath);
      }
    });
  }
});

// ─── Test-only temp-file helpers (the worker's buildGraph reads from disk) ──

let tmpCounter = 0;
function writeTempGeojson(fc: FeatureCollection): string {
  const tmpPath = path.join(os.tmpdir(), `node-delay-test-${Date.now()}-${tmpCounter++}.geojson`);
  fs.writeFileSync(tmpPath, JSON.stringify(fc));
  return tmpPath;
}
function cleanupTempGeojson(tmpPath: string): void {
  fs.unlinkSync(tmpPath);
}

import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { Feature, FeatureCollection } from "geojson";
import { SnapGrid } from "../../modules/pathfinding/snapGrid";
import { GraphBuilder } from "../../modules/roadnetwork/GraphBuilder";
import { MAX_CONTROL_SNAP_KM } from "../../modules/roadnetwork/types";
import { buildGraph } from "../../workers/pathfinding-worker";
import { calculateDistance } from "../../utils/helpers";
import type { Node } from "../../types";

/**
 * fleetsim-all-mlgo: control points that miss an exact vertex used to scan
 * every node for the nearest one, which stalled startup on large extracts.
 * `SnapGrid` replaces that scan; these tests pin it to the scan's exact answer.
 */

/** Deterministic PRNG so failures reproduce. */
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

type Pt = { id: number; lat: number; lon: number };

/** The pre-fix algorithm: global nearest (first minimum wins), then the radius check. */
function linearNearestWithin(points: Pt[], lat: number, lon: number, radiusKm: number) {
  let nearest: Pt | null = null;
  let min = Infinity;
  for (const p of points) {
    const d = calculateDistance([lat, lon], [p.lat, p.lon]);
    if (d < min) {
      min = d;
      nearest = p;
    }
  }
  return nearest && min <= radiusKm ? nearest : null;
}

function gridNearestWithin(grid: SnapGrid<Pt>, lat: number, lon: number) {
  return grid.nearestWithin(lat, lon, (p) => calculateDistance([lat, lon], [p.lat, p.lon]));
}

describe("SnapGrid.nearestWithin matches a linear nearest-node scan", () => {
  const scenarios = [
    { name: "mid latitude (Rome)", lat: 41.9, lon: 12.5 },
    { name: "equator", lat: 0.0, lon: 36.8 },
    { name: "high latitude", lat: 69.6, lon: 18.9 },
    { name: "southern hemisphere", lat: -33.9, lon: 18.4 },
  ];

  for (const { name, lat: lat0, lon: lon0 } of scenarios) {
    it(`agrees on random queries at ${name}`, () => {
      const rand = mulberry32(42);
      const points: Pt[] = [];
      // ~600 x 600 m patch, dense enough that many queries have several
      // candidates inside the radius and many have none.
      for (let i = 0; i < 2000; i++) {
        points.push({ id: i, lat: lat0 + rand() * 0.005, lon: lon0 + rand() * 0.007 });
      }
      const grid = new SnapGrid(points, (p) => [p.lat, p.lon] as const, MAX_CONTROL_SNAP_KM);
      let hits = 0;
      for (let q = 0; q < 1000; q++) {
        const lat = lat0 - 0.001 + rand() * 0.007;
        const lon = lon0 - 0.001 + rand() * 0.009;
        const expected = linearNearestWithin(points, lat, lon, MAX_CONTROL_SNAP_KM);
        expect(gridNearestWithin(grid, lat, lon)).toBe(expected);
        if (expected) hits++;
      }
      // Both branches must actually be exercised.
      expect(hits).toBeGreaterThan(100);
      expect(hits).toBeLessThan(970);
    });
  }

  it("keeps points right at the radius in every direction", () => {
    const lat0 = 41.9;
    const lon0 = 12.5;
    // A point just inside the radius: one degree of latitude is ~111.195 km.
    const r = MAX_CONTROL_SNAP_KM * 0.999;
    const dLat = r / 111.195;
    const dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
    const cases: Array<[number, number]> = [
      [lat0 + dLat, lon0],
      [lat0 - dLat, lon0],
      [lat0, lon0 + dLon],
      [lat0, lon0 - dLon],
    ];
    for (const [lat, lon] of cases) {
      const points: Pt[] = [{ id: 0, lat, lon }];
      const grid = new SnapGrid(points, (p) => [p.lat, p.lon] as const, MAX_CONTROL_SNAP_KM);
      const expected = linearNearestWithin(points, lat0, lon0, MAX_CONTROL_SNAP_KM);
      expect(expected).not.toBeNull();
      expect(gridNearestWithin(grid, lat0, lon0)).toBe(expected);
    }
  });

  it("breaks exact distance ties on insertion order, like the scan", () => {
    const lat0 = 41.9;
    const lon0 = 12.5;
    const d = 0.00005;
    // Mirror images across the query latitude are exactly equidistant, and
    // they land in different grid cells.
    const points: Pt[] = [
      { id: 0, lat: lat0 + d, lon: lon0 },
      { id: 1, lat: lat0 - d, lon: lon0 },
    ];
    const forward = new SnapGrid(points, (p) => [p.lat, p.lon] as const, MAX_CONTROL_SNAP_KM);
    const reversed = new SnapGrid(
      [...points].reverse(),
      (p) => [p.lat, p.lon] as const,
      MAX_CONTROL_SNAP_KM
    );
    expect(gridNearestWithin(forward, lat0, lon0)).toBe(
      linearNearestWithin(points, lat0, lon0, MAX_CONTROL_SNAP_KM)
    );
    expect(gridNearestWithin(reversed, lat0, lon0)).toBe(
      linearNearestWithin([...points].reverse(), lat0, lon0, MAX_CONTROL_SNAP_KM)
    );
  });

  it("returns null on an empty set and falls back to a scan near the antimeridian", () => {
    const empty = new SnapGrid<Pt>([], (p) => [p.lat, p.lon] as const, MAX_CONTROL_SNAP_KM);
    expect(gridNearestWithin(empty, 0, 0)).toBeNull();

    const points: Pt[] = [{ id: 0, lat: 10, lon: -179.99999 }];
    const grid = new SnapGrid(points, (p) => [p.lat, p.lon] as const, MAX_CONTROL_SNAP_KM);
    const expected = linearNearestWithin(points, 10, 179.99999, MAX_CONTROL_SNAP_KM);
    expect(gridNearestWithin(grid, 10, 179.99999)).toBe(expected);
  });
});

// ─── Graph-level equivalence ────────────────────────────────────────────

/**
 * A grid of two-way streets with control points scattered around it, most of
 * them OFF any vertex (so every one goes through the snap path), some inside
 * and some beyond the snap radius.
 */
function controlFixture(): FeatureCollection {
  const rand = mulberry32(7);
  const lat0 = 41.9;
  const lon0 = 12.5;
  const step = 0.0004; // ~44 m between vertices
  const n = 12;
  const features: Feature[] = [];
  for (let r = 0; r < n; r++) {
    const row: [number, number][] = [];
    const col: [number, number][] = [];
    for (let c = 0; c < n; c++) {
      row.push([lon0 + c * step, lat0 + r * step]);
      col.push([lon0 + r * step, lat0 + c * step]);
    }
    features.push({
      type: "Feature",
      properties: { id: `row${r}`, name: `Row ${r}`, highway: "residential" },
      geometry: { type: "LineString", coordinates: row },
    });
    features.push({
      type: "Feature",
      properties: { id: `col${r}`, name: `Col ${r}`, highway: "secondary" },
      geometry: { type: "LineString", coordinates: col },
    });
  }
  const kinds = [
    { highway: "traffic_signals" },
    { highway: "stop" },
    { highway: "give_way" },
    { highway: "crossing", crossing: "marked" },
    { railway: "level_crossing" },
  ];
  for (let i = 0; i < 400; i++) {
    features.push({
      type: "Feature",
      properties: { id: `p${i}`, ...kinds[i % kinds.length] },
      geometry: {
        type: "Point",
        coordinates: [
          lon0 - 0.0005 + rand() * (n * step + 0.001),
          lat0 - 0.0005 + rand() * (n * step + 0.001),
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** GraphBuilder with its control-node lookup swapped back to the old linear scan. */
function buildWithLinearScan(fc: FeatureCollection) {
  const builder = new GraphBuilder({ landmarkCount: 0 });
  const internals = builder as unknown as {
    nodes: Map<string, Node>;
    findControlNode: (lat: number, lon: number) => Node | null;
  };
  internals.findControlNode = (lat, lon) => {
    const exact = internals.nodes.get(builder.makeNodeKey(lat, lon));
    if (exact) return exact;
    let nearest: Node | null = null;
    let min = Infinity;
    for (const node of internals.nodes.values()) {
      const d = calculateDistance([lat, lon], node.coordinates);
      if (d < min) {
        min = d;
        nearest = node;
      }
    }
    return nearest && min <= MAX_CONTROL_SNAP_KM ? nearest : null;
  };
  return builder.build(fc);
}

describe("graph build with SnapGrid equals the linear-scan build", () => {
  it("attaches the same controls to the same nodes (main thread and worker)", () => {
    const fc = controlFixture();
    // build() stamps streetId onto features, so give each build its own copy.
    const reference = buildWithLinearScan(structuredClone(fc));
    const built = new GraphBuilder({ landmarkCount: 0 }).build(structuredClone(fc));

    const signals = (nodes: Map<string, Node>) =>
      [...nodes.values()].filter((n) => n.trafficSignal).map((n) => n.id);
    const delays = (edges: Map<string, { nodeDelayH?: number }>) =>
      [...edges.entries()].map(([id, e]) => [id, e.nodeDelayH ?? 0]);

    expect(signals(built.nodes)).toEqual(signals(reference.nodes));
    expect(delays(built.edges)).toEqual(delays(reference.edges));
    // The fixture must exercise the path: some controls attach, some do not.
    const delayed = delays(reference.edges).filter(([, d]) => (d as number) > 0).length;
    expect(delayed).toBeGreaterThan(20);
    expect(delayed).toBeLessThan(reference.edges.size);

    const tmp = path.join(os.tmpdir(), `snapgrid-${process.pid}-${Date.now()}.geojson`);
    fs.writeFileSync(tmp, JSON.stringify(fc));
    try {
      const workerNodes = buildGraph(tmp, 0);
      const workerDelays = new Map<string, number>();
      for (const node of workerNodes.values()) {
        for (const edge of node.edges) workerDelays.set(edge.id, edge.nodeDelayH);
      }
      for (const [id, delay] of delays(reference.edges)) {
        expect(workerDelays.get(id as string)).toBe(delay);
      }
      const workerSignals = [...workerNodes.values()]
        .filter((n) => n.trafficSignal)
        .map((n) => n.id)
        .sort();
      expect(workerSignals).toEqual(signals(reference.nodes).sort());
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

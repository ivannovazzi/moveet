import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { StateStore } from "../../modules/StateStore";
import {
  SpeedProfileManager,
  type SpeedProfileSettings,
} from "../../modules/speedprofiles/SpeedProfileManager";
import type { Edge, Route } from "../../types";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

vi.mock("../../utils/logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: log, createLogger: () => log };
});

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true, recursive: true });
});

const west = gridPos(1, 0);
const centre = gridPos(1, 1);
const east = gridPos(1, 2);

/** Local-time epoch ms for weekday `day` (0 = Sunday) at `hour:minute`. */
function at(day: number, hour: number, minute = 0): number {
  const d = new Date(2026, 0, 4, hour, minute, 0, 0); // a Sunday
  d.setDate(d.getDate() + day);
  return d.getTime();
}

const MONDAY_8 = at(1, 8, 10);

function setup(overrides: Partial<SpeedProfileSettings> = {}, networkFile?: string) {
  const file = networkFile ?? writeTmpNetwork(gridFeatures());
  tmpFiles.push(file);
  const network = new RoadNetwork(file, { landmarkCount: 2, speedProfileRatio: 1 });
  const clock = { now: MONDAY_8 };
  const manager = new SpeedProfileManager(
    network,
    {
      sources: ["sim"],
      layout: { period: "week", bucketHours: 1 },
      minSamples: 3,
      alpha: 0.2,
      publishIntervalMs: 60_000,
      ...overrides,
    },
    () => clock.now
  );
  manager.install();
  const edge = (a: [number, number], b: [number, number]): Edge => {
    const from = network.findNearestNode(a);
    const to = network.findNearestNode(b);
    return from.connections.find((e) => e.end.id === to.id)!;
  };
  const route = (): Route =>
    network.findRoute(network.findNearestNode(west), network.findNearestNode(east))!;
  return { file, network, clock, manager, edge, route };
}

const ids = (r: Route) => r.edges.map((e) => e.id);

describe("SpeedProfileManager", () => {
  it("changes routing and ETA pricing for the observed time bucket only", () => {
    const { network, clock, manager, edge, route } = setup();
    const slow = edge(west, centre);
    const straight = ids(route());
    expect(straight).toContain(slow.id);

    for (let i = 0; i < 3; i++) manager.observe(slow, 2, MONDAY_8 + i * 1000, "sim");

    // Same bucket (Monday 08:xx): the learned speed applies.
    clock.now = at(1, 8, 40);
    expect(ids(route())).not.toContain(slow.id);
    expect(network.learnedSpeedKmh(slow)).toBeCloseTo(2, 5);

    // Another bucket (Monday 10:00, and Tuesday 08:00): static cost again.
    clock.now = at(1, 10);
    expect(ids(route())).toEqual(straight);
    expect(network.learnedSpeedKmh(slow)).toBeUndefined();
    clock.now = at(2, 8, 5);
    expect(ids(route())).toEqual(straight);
  });

  // fleetsim-all-1ajn.5: observations must be normalised to clear-weather speed
  // when recorded, or a rainy-day observation would bake the weather slowdown
  // into the learned speed and then get slowed down AGAIN when the live
  // weather factor is applied on top at route/ETA time.
  it("normalises an observation by the weather factor in effect when recorded", () => {
    const { network, manager, edge } = setup();
    const slow = edge(west, centre);

    network.setWeatherFactor(0.5);
    // Observed running speed is 2 km/h while it's raining (factor 0.5): the
    // clear-weather speed the profile should learn is 2 / 0.5 = 4 km/h, not
    // the raw 2 (which would double-count the weather slowdown once routing
    // re-applies the live factor on top of the learned speed).
    for (let i = 0; i < 3; i++) manager.observe(slow, 2, MONDAY_8 + i * 1000, "sim");
    manager.publish();

    expect(network.learnedSpeedKmh(slow)).toBeCloseTo(4, 5);
  });

  it("falls back to the static cost until a bucket has enough samples", () => {
    const { network, manager, edge, route } = setup();
    const slow = edge(west, centre);
    const straight = ids(route());
    manager.observe(slow, 2, MONDAY_8, "sim");
    manager.observe(slow, 2, MONDAY_8, "sim");
    manager.publish();
    expect(ids(route())).toEqual(straight);
    expect(network.learnedSpeedKmh(slow)).toBeUndefined();
  });

  it("only accepts observations from enabled sources and real graph edges", () => {
    const { network, manager, edge } = setup({ sources: ["sim"] });
    const e = edge(west, centre);
    expect(manager.observe(e, 20, MONDAY_8, "adapter")).toBe(false);
    expect(manager.observe(network.getFallbackEdge(e), 20, MONDAY_8, "sim")).toBe(false);
    expect(manager.observe(e, 20, MONDAY_8, "sim")).toBe(true);
    expect(manager.recorder).not.toBeNull();
    expect(manager.fixMatcher).toBeNull();
    expect(manager.ingestFixes([])).toBeNull();
  });

  it("throttles re-publishing new samples but publishes a bucket change at once", () => {
    const { network, clock, manager, edge, route } = setup({ minSamples: 1 });
    const e = edge(west, centre);
    route(); // first request publishes
    const v1 = network.speedProfileVersion;
    manager.observe(e, 5, clock.now, "sim");
    route();
    expect(network.speedProfileVersion).toBe(v1); // within the publish interval
    clock.now += 61_000;
    route();
    expect(network.speedProfileVersion).toBe(v1 + 1);
    clock.now = at(1, 9);
    route();
    expect(network.speedProfileVersion).toBe(v1 + 2);
    route();
    expect(network.speedProfileVersion).toBe(v1 + 2); // nothing new
  });

  it("feeds adapter fixes through the map matcher when that source is enabled", () => {
    const { manager, edge } = setup({ sources: ["adapter"] });
    expect(manager.recorder).toBeNull();
    const e = edge(west, centre);
    const p = (t: number): [number, number] => [
      west[0] + (centre[0] - west[0]) * t,
      west[1] + (centre[1] - west[1]) * t,
    ];
    const result = manager.ingestFixes([
      { vehicleId: "real-1", position: p(0.2), timestamp: MONDAY_8 },
      { vehicleId: "real-1", position: p(0.8), timestamp: MONDAY_8 + 8_000 },
    ]);
    expect(result).toEqual({ fixes: 2, observations: 1 });
    const bucket = manager.stats().currentBucket;
    expect(manager.store.sample(manager.network.edgeIndexOf(e), bucket)!.count).toBe(1);
  });

  it("exports and re-imports a profile file keyed by stable edge ids", () => {
    const a = setup();
    const e = a.edge(west, centre);
    for (let i = 0; i < 4; i++) a.manager.observe(e, 7, MONDAY_8, "sim");
    const file = JSON.parse(JSON.stringify(a.manager.exportFile()));
    expect(file.edges).toEqual([
      expect.objectContaining({ id: e.id, way: e.streetId, b: [[32, 7, 4]] }),
    ]);

    // A separate run on a separately-built copy of the network.
    const b = setup();
    const result = b.manager.importFile(file, "merge");
    expect(result).toEqual({ matchedEdges: 1, unmatchedEdges: 0, entries: 1 });
    expect(b.network.learnedSpeedKmh(b.edge(west, centre))).toBeCloseTo(7, 5);

    b.manager.importFile({ ...file, edges: [] }, "replace");
    expect(b.manager.stats().observedEdges).toBe(0);
  });

  it("persists profiles through the StateStore across a restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speed-profiles-"));
    tmpFiles.push(dir);
    const dbPath = path.join(dir, "state.db");
    const networkFile = writeTmpNetwork(gridFeatures());

    const first = setup({}, networkFile);
    const e = first.edge(west, centre);
    for (let i = 0; i < 3; i++) first.manager.observe(e, 9, MONDAY_8, "sim");
    const store1 = new StateStore(dbPath);
    expect(first.manager.saveTo(store1)).toBe(1);
    expect(first.manager.saveTo(store1)).toBe(0); // nothing dirty
    store1.close();

    // "Restart": new network, new manager, reopened database.
    const second = setup({}, networkFile);
    const store2 = new StateStore(dbPath);
    expect(second.manager.loadFrom(store2)).toEqual({ rows: 1, unmatched: 0 });
    expect(second.network.learnedSpeedKmh(second.edge(west, centre))).toBeCloseTo(9, 5);
    store2.close();

    // A run with a coarser layout re-buckets what it loads.
    const third = setup({ layout: { period: "day", bucketHours: 6 } }, networkFile);
    const store3 = new StateStore(dbPath);
    third.manager.loadFrom(store3);
    const idx = third.network.edgeIndexOf(third.edge(west, centre));
    expect(third.manager.store.sample(idx, 1)).toEqual({ speedKmh: 9, count: 3 });
    store3.close();
  });

  it("applies a seed file once per content across restarts (counts are not re-merged)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "speed-profiles-seed-"));
    tmpFiles.push(dir);
    const dbPath = path.join(dir, "state.db");
    const networkFile = writeTmpNetwork(gridFeatures());

    const source = setup({}, networkFile);
    const e = source.edge(west, centre);
    for (let i = 0; i < 4; i++) source.manager.observe(e, 7, MONDAY_8, "sim");
    const seed = JSON.stringify(source.manager.exportFile());

    /** One simulator boot: load persisted rows, apply the seed, save, shut down. */
    const boot = (content: string) => {
      const run = setup({}, networkFile);
      const store = new StateStore(dbPath);
      run.manager.loadFrom(store);
      const outcome = run.manager.applySeedFile(content, store);
      run.manager.saveTo(store);
      const idx = run.network.edgeIndexOf(run.edge(west, centre));
      const count = run.manager.store.sample(idx, run.manager.stats().currentBucket)?.count;
      store.close();
      return { applied: outcome.applied, count };
    };

    expect(boot(seed)).toEqual({ applied: true, count: 4 });
    expect(boot(seed)).toEqual({ applied: false, count: 4 });
    expect(boot(seed)).toEqual({ applied: false, count: 4 });

    // A changed seed file is applied (once).
    for (let i = 0; i < 2; i++) source.manager.observe(e, 7, MONDAY_8, "sim");
    const changed = JSON.stringify(source.manager.exportFile());
    expect(boot(changed).applied).toBe(true);
    expect(boot(changed).applied).toBe(false);
  });

  it("applies a seed file every boot when there is no state store (nothing accumulates)", () => {
    const source = setup();
    for (let i = 0; i < 4; i++)
      source.manager.observe(source.edge(west, centre), 7, MONDAY_8, "sim");
    const seed = JSON.stringify(source.manager.exportFile());
    const run = setup();
    expect(run.manager.applySeedFile(seed).applied).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  bucketCount,
  bucketOfTime,
  bucketOfHourOfWeek,
  bucketMapping,
  parseBucketLayout,
  type BucketLayout,
} from "../../modules/speedprofiles/buckets";
import {
  SpeedProfileStore,
  SPEED_PROFILE_FILE_FORMAT,
} from "../../modules/speedprofiles/SpeedProfileStore";

const WEEK_1H: BucketLayout = { period: "week", bucketHours: 1 };
const DAY_1H: BucketLayout = { period: "day", bucketHours: 1 };

/** Local-time epoch ms for a given weekday (0 = Sunday) and hour. */
function at(day: number, hour: number, minute = 0): number {
  const d = new Date(2026, 0, 4, hour, minute, 0, 0); // 2026-01-04 is a Sunday
  d.setDate(d.getDate() + day);
  return d.getTime();
}

describe("speed profile buckets", () => {
  it("counts buckets per period", () => {
    expect(bucketCount(WEEK_1H)).toBe(168);
    expect(bucketCount({ period: "week", bucketHours: 24 })).toBe(7);
    expect(bucketCount(DAY_1H)).toBe(24);
    expect(bucketCount({ period: "day", bucketHours: 6 })).toBe(4);
  });

  it("maps a local timestamp to its hour-of-week bucket", () => {
    expect(bucketOfTime(WEEK_1H, at(0, 0))).toBe(0);
    expect(bucketOfTime(WEEK_1H, at(1, 8, 59))).toBe(24 + 8);
    expect(bucketOfTime(WEEK_1H, at(6, 23))).toBe(167);
    expect(bucketOfTime({ period: "week", bucketHours: 3 }, at(1, 8))).toBe(Math.floor(32 / 3));
  });

  it("folds weekdays together in a day period", () => {
    expect(bucketOfTime(DAY_1H, at(0, 8))).toBe(8);
    expect(bucketOfTime(DAY_1H, at(4, 8))).toBe(8);
    expect(bucketOfHourOfWeek({ period: "day", bucketHours: 6 }, 24 * 3 + 13)).toBe(2);
  });

  it("rejects bucket widths that do not divide the period", () => {
    expect(() => parseBucketLayout("week", 5)).toThrow();
    expect(() => parseBucketLayout("day", 48)).toThrow();
    expect(parseBucketLayout("day", 8)).toEqual({ period: "day", bucketHours: 8 });
  });

  it("maps source buckets onto every target bucket they overlap", () => {
    // week/1h -> day/6h: hour-of-week 32 (Mon 08:00) lands in day bucket 1.
    const coarse = bucketMapping(WEEK_1H, { period: "day", bucketHours: 6 });
    expect(coarse[32]).toEqual([1]);
    // day/12h -> week/24h: the afternoon bucket covers every weekday.
    const wide = bucketMapping(
      { period: "day", bucketHours: 12 },
      { period: "week", bucketHours: 24 }
    );
    expect(wide[1]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("SpeedProfileStore", () => {
  it("returns nothing for an unobserved edge", () => {
    const store = new SpeedProfileStore(10, WEEK_1H, 0.2);
    expect(store.sample(3, 5)).toBeNull();
    expect(store.speedFor(3, 5, 1)).toBe(0);
    expect(store.observedEdgeCount).toBe(0);
  });

  it("averages early samples, then follows an EWMA", () => {
    const store = new SpeedProfileStore(4, WEEK_1H, 0.2);
    store.record(1, 7, 30);
    store.record(1, 7, 50);
    // First two samples: cumulative mean (1/n exceeds alpha).
    expect(store.sample(1, 7)).toEqual({ speedKmh: 40, count: 2 });
    for (let i = 0; i < 20; i++) store.record(1, 7, 10);
    const s = store.sample(1, 7)!;
    expect(s.count).toBe(22);
    expect(s.speedKmh).toBeLessThan(12);
    expect(s.speedKmh).toBeGreaterThan(10);
  });

  it("keeps buckets independent", () => {
    const store = new SpeedProfileStore(4, WEEK_1H, 0.2);
    store.record(2, 8, 12);
    expect(store.sample(2, 8)!.speedKmh).toBeCloseTo(12, 5);
    expect(store.sample(2, 9)).toBeNull();
  });

  it("gates speedFor on the minimum sample count", () => {
    const store = new SpeedProfileStore(4, WEEK_1H, 0.2);
    for (let i = 0; i < 4; i++) store.record(0, 0, 20);
    expect(store.speedFor(0, 0, 5)).toBe(0);
    store.record(0, 0, 20);
    expect(store.speedFor(0, 0, 5)).toBeCloseTo(20, 5);
  });

  it("ignores non-finite, non-positive and out-of-range observations", () => {
    const store = new SpeedProfileStore(4, WEEK_1H, 0.2);
    expect(store.record(0, 0, NaN)).toBe(false);
    expect(store.record(0, 0, 0)).toBe(false);
    expect(store.record(9, 0, 10)).toBe(false);
    expect(store.record(0, 168, 10)).toBe(false);
    expect(store.observedEdgeCount).toBe(0);
  });

  it("builds a sparse override table for one bucket", () => {
    const store = new SpeedProfileStore(6, WEEK_1H, 0.2);
    for (let i = 0; i < 3; i++) {
      store.record(4, 10, 15);
      store.record(1, 10, 25);
      store.record(2, 11, 35);
    }
    store.record(5, 10, 45); // below min samples
    const table = store.overridesFor(10, 3);
    expect([...table.indices]).toEqual([1, 4]);
    expect([...table.speeds].map((s) => Math.round(s))).toEqual([25, 15]);
  });

  it("tracks which edges changed since the last drain", () => {
    const store = new SpeedProfileStore(6, WEEK_1H, 0.2);
    store.record(3, 1, 10);
    store.record(1, 1, 10);
    store.record(3, 2, 10);
    expect(store.takeDirty().sort()).toEqual([1, 3]);
    expect(store.takeDirty()).toEqual([]);
  });

  it("merges imported entries by sample count and re-buckets other layouts", () => {
    const store = new SpeedProfileStore(3, WEEK_1H, 0.2);
    store.importEntries(0, WEEK_1H, [[32, 20, 2]]);
    store.importEntries(0, WEEK_1H, [[32, 50, 1]]);
    expect(store.sample(0, 32)).toEqual({ speedKmh: 30, count: 3 });

    // A day/1h entry for 08:00 applies to 08:00 on every weekday.
    store.importEntries(1, DAY_1H, [[8, 40, 4]]);
    for (let day = 0; day < 7; day++) {
      expect(store.sample(1, day * 24 + 8)).toEqual({ speedKmh: 40, count: 4 });
    }
    expect(store.sample(1, 9)).toBeNull();
  });

  it("round-trips through the JSON profile file keyed by edge id", () => {
    const ids = ["a-b", "b-c", "c-d"];
    const store = new SpeedProfileStore(3, WEEK_1H, 0.2);
    store.record(2, 40, 18);
    store.record(2, 41, 22);
    store.record(0, 40, 33);

    const file = store.toFile((i) => ({ id: ids[i], way: `w${i}` }));
    expect(file.format).toBe(SPEED_PROFILE_FILE_FORMAT);
    expect(file.edges).toHaveLength(2);
    // JSON-safe (it is written to disk / sent over HTTP).
    const parsed = JSON.parse(JSON.stringify(file));

    // Seed a different network: "a-b" is gone, one unknown id is added.
    const otherIds = ["x-y", "b-c", "c-d"];
    const target = new SpeedProfileStore(3, WEEK_1H, 0.2);
    parsed.edges.push({ id: "nope", b: [[1, 10, 1]] });
    const result = target.importFile(parsed, (id) => otherIds.indexOf(id));
    expect(result).toEqual({ matchedEdges: 1, unmatchedEdges: 2, entries: 2 });
    expect(target.sample(2, 40)!.speedKmh).toBeCloseTo(18, 4);
    expect(target.sample(2, 41)!.speedKmh).toBeCloseTo(22, 4);
    expect(target.sample(0, 40)).toBeNull();
  });

  it("round-trips dense rows for persistence", () => {
    const store = new SpeedProfileStore(2, DAY_1H, 0.2);
    store.record(1, 5, 12);
    store.record(1, 23, 48);
    const row = store.row(1)!;
    expect(row.speeds).toBeInstanceOf(Float32Array);
    expect(row.counts).toBeInstanceOf(Uint16Array);
    expect(row.speeds.length).toBe(24);

    const copy = new SpeedProfileStore(2, DAY_1H, 0.2);
    copy.importRow(1, DAY_1H, row.speeds, row.counts);
    expect(copy.sample(1, 5)).toEqual(store.sample(1, 5));
    expect(copy.sample(1, 23)).toEqual(store.sample(1, 23));
    expect(store.row(0)).toBeNull();
  });

  it("clears everything", () => {
    const store = new SpeedProfileStore(2, DAY_1H, 0.2);
    store.record(1, 5, 12);
    store.clear();
    expect(store.sample(1, 5)).toBeNull();
    expect(store.observedEdgeCount).toBe(0);
    expect(store.totalSamples).toBe(0);
  });
});

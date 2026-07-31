import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_BUCKET_AGGREGATION,
  type AnalyticsAggregatedField,
  type AnalyticsBucketMeta,
  type AnalyticsHistoryMeta,
  type AnalyticsHistoryRow,
} from "@moveet/shared-types";
import {
  BUCKET_AGGREGATION,
  describeAggregation,
  fetchAnalyticsHistory,
  readHistoryPayload,
  rowsToSeries,
} from "./useAnalytics";
import type { AnalyticsSummary, FleetAnalytics } from "./analyticsStore";

const T0 = Date.UTC(2026, 6, 25, 10, 0, 0);

function makeSummary(index: number): AnalyticsSummary {
  return {
    totalVehicles: 10,
    activeVehicles: 6 + index,
    totalDistanceTraveled: 100 + index * 10,
    avgSpeed: 30 + index,
    totalIdleTime: 20,
    avgRouteEfficiency: 0.8,
    timestamp: T0 + index * 300_000,
  };
}

function makeFleet(overrides: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    fleetId: "alpha",
    vehicleCount: 4,
    activeCount: 3,
    totalDistance: 42,
    avgSpeed: 31,
    totalIdleTime: 5,
    routeEfficiency: 0.9,
    vehicles: [],
    ...overrides,
  };
}

/** A server-side bucketed row: bucket-start timestamp plus its provenance. */
function makeBucketedRow(index: number): AnalyticsHistoryRow {
  const start = T0 + index * 300_000;
  return {
    id: index,
    timestamp: new Date(start).toISOString(),
    summary: makeSummary(index),
    fleets: [makeFleet()],
    bucket: {
      durationMs: 300_000,
      label: "5m",
      start: new Date(start).toISOString(),
      end: new Date(start + 300_000).toISOString(),
      sampleCount: 60,
      firstTimestamp: new Date(start).toISOString(),
      lastTimestamp: new Date(start + 295_000).toISOString(),
    },
  };
}

const BUCKET_META: AnalyticsBucketMeta = {
  durationMs: 300_000,
  label: "5m",
  count: 2,
  sampleCount: 120,
  auto: true,
  aggregation: ANALYTICS_BUCKET_AGGREGATION,
};

function makeMeta(overrides: Partial<AnalyticsHistoryMeta> = {}): AnalyticsHistoryMeta {
  return {
    matched: 120,
    scanned: 120,
    returned: 2,
    omitted: 0,
    truncated: false,
    anchor: "newest",
    limit: 240,
    order: "asc",
    from: new Date(T0).toISOString(),
    to: null,
    coveredFrom: new Date(T0).toISOString(),
    coveredTo: new Date(T0 + 300_000).toISOString(),
    windowFrom: new Date(T0).toISOString(),
    windowTo: new Date(T0 + 300_000).toISOString(),
    bucket: BUCKET_META,
    ...overrides,
  };
}

describe("fetchAnalyticsHistory", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the simulator to bucket server-side and to answer with an envelope", async () => {
    const from = new Date(T0).toISOString();
    await fetchAnalyticsHistory({ from, limit: 240, bucket: "auto" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));

    expect(url.pathname).toBe("/analytics/history");
    expect(url.searchParams.get("from")).toBe(from);
    expect(url.searchParams.get("limit")).toBe("240");
    expect(url.searchParams.get("bucket")).toBe("auto");
    expect(url.searchParams.get("envelope")).toBe("true");
  });
});

describe("readHistoryPayload", () => {
  it("unwraps the enveloped body", () => {
    const meta = makeMeta();
    const rows = [makeBucketedRow(0), makeBucketedRow(1)];

    expect(readHistoryPayload({ meta, rows })).toEqual({ meta, rows });
  });

  it("accepts a bare array from a simulator that ignores the envelope flag", () => {
    const rows = [makeBucketedRow(0)];

    expect(readHistoryPayload(rows)).toEqual({ rows, meta: null });
  });

  it("treats an unusable body as empty rather than throwing", () => {
    expect(readHistoryPayload(undefined)).toEqual({ rows: [], meta: null });
    expect(readHistoryPayload(null)).toEqual({ rows: [], meta: null });
  });
});

describe("rowsToSeries", () => {
  it("reads bucketed rows unchanged — the bucket start is the frame time", () => {
    const { summaries, fleetHistory } = rowsToSeries([makeBucketedRow(1), makeBucketedRow(0)]);

    expect(summaries.map((s) => s.timestamp)).toEqual([T0, T0 + 300_000]);
    expect(summaries[0].avgSpeed).toBe(30);
    expect(fleetHistory.get("alpha")).toHaveLength(2);
  });
});

describe("describeAggregation", () => {
  it("says nothing when the rows are verbatim samples", () => {
    expect(describeAggregation("avgSpeed", null)).toBeUndefined();
    expect(describeAggregation("totalDistanceTraveled", null)).toBeUndefined();
  });

  it("calls a cumulative counter a last-in-bucket value, not an average", () => {
    const hint = describeAggregation("totalDistanceTraveled", BUCKET_META);

    expect(hint).toMatch(/cumulative counter/i);
    expect(hint).toMatch(/last sample in its 5m bucket/i);
    expect(hint).toMatch(/not an average/i);
  });

  it("calls a gauge a bucket mean", () => {
    for (const measure of ["avgSpeed", "activeVehicles", "avgRouteEfficiency"] as const) {
      const hint = describeAggregation(measure, BUCKET_META);
      expect(hint).toMatch(/mean of the samples in its 5m bucket/i);
      expect(hint).not.toMatch(/cumulative/i);
    }
  });

  // The split is no longer restated here: `BUCKET_AGGREGATION` is derived from
  // the shared `ANALYTICS_BUCKET_AGGREGATION` contract, and the derivation
  // indexes it by `summary.<measure>`, so renaming a field in the simulator
  // fails to compile here rather than drifting past a hand-copied literal.
  // What is still worth asserting is that the narrowing itself is faithful.
  it("narrows every plotted measure to the fold the shared contract states", () => {
    for (const [measure, fold] of Object.entries(BUCKET_AGGREGATION)) {
      const declared =
        ANALYTICS_BUCKET_AGGREGATION[`summary.${measure}` as AnalyticsAggregatedField];
      expect(declared).toBeDefined();
      expect(declared).toMatch(fold === "last" ? /^last/ : /^mean$/);
    }
  });
});

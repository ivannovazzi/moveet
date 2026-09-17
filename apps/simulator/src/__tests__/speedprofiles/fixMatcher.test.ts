import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "fs";
import { FixMatcher } from "../../modules/speedprofiles/FixMatcher";
import { RoadNetwork } from "../../modules/RoadNetwork";
import type { Edge } from "../../types";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

const file = writeTmpNetwork(gridFeatures());
afterAll(() => fs.rmSync(file, { force: true }));
const network = new RoadNetwork(file, { landmarkCount: 0 });

/** A point `t` of the way from grid cell a to grid cell b, nudged `offsetDeg` north. */
function along(
  a: [number, number],
  b: [number, number],
  t: number,
  offsetDeg = 0
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t + offsetDeg, a[1] + (b[1] - a[1]) * t];
}

function edgeBetween(a: [number, number], b: [number, number]): Edge {
  const from = network.findNearestNode(a);
  const to = network.findNearestNode(b);
  return from.connections.find((e) => e.end.id === to.id)!;
}

const west = gridPos(1, 0);
const centre = gridPos(1, 1);

describe("FixMatcher (adapter source, consecutive fixes on one edge)", () => {
  it("turns two fixes moving along an edge into a running-speed observation", () => {
    const sink = vi.fn();
    const matcher = new FixMatcher(network, sink);
    const edge = edgeBetween(west, centre);
    const km = edge.distance * 0.6;
    const ms = (km / 36) * 3_600_000; // 36 km/h

    expect(
      matcher.ingest({
        vehicleId: "t1",
        position: along(west, centre, 0.2, 0.00002),
        timestamp: 1_000,
      })
    ).toBe(false);
    expect(
      matcher.ingest({ vehicleId: "t1", position: along(west, centre, 0.8), timestamp: 1_000 + ms })
    ).toBe(true);

    expect(sink).toHaveBeenCalledTimes(1);
    const [matched, speed, at] = sink.mock.calls[0];
    expect(matched).toBe(edge);
    expect(speed).toBeCloseTo(36, 0);
    expect(at).toBe(1_000 + ms);
  });

  it("picks the direction of travel", () => {
    const sink = vi.fn();
    const matcher = new FixMatcher(network, sink);
    matcher.ingest({ vehicleId: "t2", position: along(west, centre, 0.8), timestamp: 0 });
    matcher.ingest({ vehicleId: "t2", position: along(west, centre, 0.3), timestamp: 5_000 });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe(edgeBetween(centre, west));
  });

  it("ignores pairs on different edges, near an edge end, too far apart in time, or off-road", () => {
    const sink = vi.fn();
    const matcher = new FixMatcher(network, sink);
    const north = gridPos(0, 1);
    // different edges
    matcher.ingest({ vehicleId: "a", position: along(west, centre, 0.5), timestamp: 0 });
    matcher.ingest({ vehicleId: "a", position: along(centre, north, 0.5), timestamp: 5_000 });
    // second fix at the node (dwell at a signal would be inside the window)
    matcher.ingest({ vehicleId: "b", position: along(west, centre, 0.3), timestamp: 0 });
    matcher.ingest({ vehicleId: "b", position: along(west, centre, 0.99), timestamp: 5_000 });
    // stale gap
    matcher.ingest({ vehicleId: "c", position: along(west, centre, 0.2), timestamp: 0 });
    matcher.ingest({ vehicleId: "c", position: along(west, centre, 0.8), timestamp: 10 * 60_000 });
    // off-road (~55 m north of the street, beyond the 30 m snap radius)
    matcher.ingest({ vehicleId: "d", position: along(west, centre, 0.2, 0.0005), timestamp: 0 });
    matcher.ingest({
      vehicleId: "d",
      position: along(west, centre, 0.8, 0.0005),
      timestamp: 5_000,
    });
    // out-of-order timestamps
    matcher.ingest({ vehicleId: "e", position: along(west, centre, 0.2), timestamp: 5_000 });
    matcher.ingest({ vehicleId: "e", position: along(west, centre, 0.8), timestamp: 1_000 });
    expect(sink).not.toHaveBeenCalled();
  });

  it("rejects implausible speeds", () => {
    const sink = vi.fn();
    const matcher = new FixMatcher(network, sink);
    matcher.ingest({ vehicleId: "f", position: along(west, centre, 0.1), timestamp: 0 });
    matcher.ingest({ vehicleId: "f", position: along(west, centre, 0.9), timestamp: 100 });
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("FixMatcher per-vehicle state stays bounded", () => {
  const onEdge = along(west, centre, 0.5);

  it("sweeps vehicles whose last fix is older than maxGapMs", () => {
    const matcher = new FixMatcher(network, vi.fn(), {
      maxGapMs: 1_000,
      maxTrackedVehicles: 1_000,
    });
    for (let i = 0; i < 50; i++) {
      matcher.ingest({ vehicleId: `old-${i}`, position: onEdge, timestamp: 1_000 + i });
    }
    expect(matcher.trackedVehicles).toBe(50);
    // A fix far later: every earlier entry is past maxGapMs and useless.
    matcher.ingest({ vehicleId: "new", position: onEdge, timestamp: 1_000_000 });
    expect(matcher.trackedVehicles).toBe(1);
  });

  it("caps the number of tracked vehicles, evicting the least recently seen", () => {
    const matcher = new FixMatcher(network, vi.fn(), { maxTrackedVehicles: 10 });
    for (let i = 0; i < 25; i++) {
      matcher.ingest({ vehicleId: `v-${i}`, position: onEdge, timestamp: 1_000 + i });
    }
    expect(matcher.trackedVehicles).toBe(10);
  });
});

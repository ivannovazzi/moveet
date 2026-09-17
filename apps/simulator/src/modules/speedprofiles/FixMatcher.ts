/**
 * The `adapter` observation source for learned speed profiles
 * (fleetsim-all-1ajn.4): turns real vehicle position fixes into per-edge
 * running speeds.
 *
 * Deliberately basic map matching — "nearest edge + consecutive fixes":
 *  1. each fix is projected onto the edges touching its nearest graph node
 *     (outbound and inbound), keeping the closest within `maxSnapKm`;
 *  2. when a vehicle's previous fix matched the SAME road segment (either
 *     direction) and both fixes lie inside the edge, away from its ends by
 *     `endMargin`, the distance between them along the segment over the time
 *     between them is the running speed; the direction of travel picks which
 *     directed edge it belongs to.
 * Requiring both fixes on one edge and away from its ends keeps node delays
 * (signals, stops) and turns out of the measurement, the same reasoning as the
 * `sim` source's straight-through rule (see `TraversalRecorder`). Sparse fixes
 * (one per edge or fewer) therefore yield nothing; a proper HMM map matcher is
 * the upgrade path and can feed the same sink.
 *
 * Fixes are bucketed by their own timestamp (real time), not the sim clock.
 */

import type { Edge, Node } from "../../types";

export interface PositionFix {
  vehicleId: string;
  /** `[lat, lon]`. */
  position: [number, number];
  /** Epoch ms when the position was measured. */
  timestamp: number;
}

/** Receives one matched observation: edge, running speed (km/h), fix time (epoch ms). */
export type FixObservationSink = (edge: Edge, speedKmh: number, atMs: number) => void;

export interface FixMatcherNetwork {
  findNearestNode(position: [number, number]): Node;
}

export interface FixMatcherOptions {
  /** Max distance (km) from a fix to the edge it is matched to. */
  maxSnapKm: number;
  /** Max time (ms) between two fixes that can form an observation. */
  maxGapMs: number;
  /** Min distance (km) travelled along the edge between the two fixes. */
  minTravelKm: number;
  /** Speeds above this (km/h) are GPS noise, not traffic. */
  maxSpeedKmh: number;
  /** Fraction of the edge at each end inside which a fix does not count. */
  endMargin: number;
  /**
   * Most vehicles whose last fix is remembered; the least recently seen are
   * evicted beyond it, so a stream of one-off vehicle ids cannot grow memory
   * without bound.
   */
  maxTrackedVehicles: number;
}

export const DEFAULT_FIX_MATCHER_OPTIONS: FixMatcherOptions = {
  maxSnapKm: 0.03,
  maxGapMs: 120_000,
  minTravelKm: 0.015,
  maxSpeedKmh: 250,
  endMargin: 0.05,
  maxTrackedVehicles: 10_000,
};

interface Match {
  edge: Edge;
  /** Position along `edge`, 0 at start .. 1 at end. */
  t: number;
  timestamp: number;
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

export class FixMatcher {
  private readonly options: FixMatcherOptions;
  /** Last matched fix per vehicle, least recently seen first (Map insertion order). */
  private readonly last = new Map<string, Match>();
  /** Fix time of the last stale-entry sweep. */
  private lastSweepAt = -Infinity;

  constructor(
    private readonly network: FixMatcherNetwork,
    private readonly sink: FixObservationSink,
    options: Partial<FixMatcherOptions> = {}
  ) {
    this.options = { ...DEFAULT_FIX_MATCHER_OPTIONS, ...options };
  }

  /** Feeds one fix. Returns true when it completed an observation. */
  ingest(fix: PositionFix): boolean {
    const previous = this.last.get(fix.vehicleId);
    if (previous && fix.timestamp <= previous.timestamp) return false; // stale / out of order
    this.sweep(fix.timestamp);
    const match = this.match(fix.position);
    this.last.delete(fix.vehicleId);
    if (!match) return false;
    const current: Match = { ...match, timestamp: fix.timestamp };
    // Re-inserted so the Map stays ordered least- to most-recently seen.
    this.last.set(fix.vehicleId, current);
    while (this.last.size > this.options.maxTrackedVehicles) {
      this.last.delete(this.last.keys().next().value!);
    }
    if (!previous) return false;
    return this.observe(previous, current);
  }

  /** Number of vehicles whose last fix is currently remembered. */
  get trackedVehicles(): number {
    return this.last.size;
  }

  /**
   * Drops vehicles whose last fix is more than `maxGapMs` older than `now` (a
   * fix time): it can never pair with a later fix. Runs at most once per
   * `maxGapMs` of fix time, so ingest stays amortised O(1).
   */
  private sweep(now: number): void {
    const { maxGapMs } = this.options;
    if (now - this.lastSweepAt < maxGapMs) return;
    this.lastSweepAt = now;
    const cutoff = now - maxGapMs;
    for (const [vehicleId, match] of this.last) {
      if (match.timestamp < cutoff) this.last.delete(vehicleId);
    }
  }

  /** Drops a vehicle's last fix (e.g. when it leaves the fleet). */
  forget(vehicleId: string): void {
    this.last.delete(vehicleId);
  }

  private observe(a: Match, b: Match): boolean {
    const { endMargin, maxGapMs, minTravelKm, maxSpeedKmh } = this.options;
    const dtMs = b.timestamp - a.timestamp;
    if (dtMs > maxGapMs) return false;

    // Express the first fix on the second fix's directed edge.
    let ta: number;
    if (a.edge === b.edge) ta = a.t;
    else if (a.edge.start === b.edge.end && a.edge.end === b.edge.start) ta = 1 - a.t;
    else return false;
    const tb = b.t;
    const inside = (t: number) => t >= endMargin && t <= 1 - endMargin;
    if (!inside(ta) || !inside(tb)) return false;

    // Moving toward the start means the vehicle drives the reverse edge.
    let edge = b.edge;
    let travelled = (tb - ta) * edge.distance;
    if (travelled < 0) {
      const reverse = edge.end.connections.find((e) => e.end === edge.start);
      if (!reverse) return false; // against a one-way: noise
      edge = reverse;
      travelled = -travelled;
    }
    if (travelled < minTravelKm) return false;
    const speedKmh = travelled / (dtMs / 3_600_000);
    if (speedKmh > maxSpeedKmh) return false;
    this.sink(edge, speedKmh, b.timestamp);
    return true;
  }

  /** Closest projection of `position` onto the edges around its nearest node. */
  private match(position: [number, number]): Omit<Match, "timestamp"> | null {
    const node = this.network.findNearestNode(position);
    const candidates = new Set<Edge>(node.connections);
    for (const out of node.connections) {
      for (const back of out.end.connections) if (back.end === node) candidates.add(back);
    }
    let best: Omit<Match, "timestamp"> | null = null;
    let bestKm = this.options.maxSnapKm;
    for (const edge of candidates) {
      const p = project(position, edge.start.coordinates, edge.end.coordinates);
      if (p.km <= bestKm) {
        bestKm = p.km;
        best = { edge, t: p.t };
      }
    }
    return best;
  }
}

/** Equirectangular projection of `p` onto segment a→b: fraction along it and distance (km). */
function project(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): { t: number; km: number } {
  const kx = KM_PER_DEG_LON_EQUATOR * Math.cos((a[0] * Math.PI) / 180);
  const bx = (b[1] - a[1]) * kx;
  const by = (b[0] - a[0]) * KM_PER_DEG_LAT;
  const px = (p[1] - a[1]) * kx;
  const py = (p[0] - a[0]) * KM_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
  const dx = px - t * bx;
  const dy = py - t * by;
  return { t, km: Math.sqrt(dx * dx + dy * dy) };
}

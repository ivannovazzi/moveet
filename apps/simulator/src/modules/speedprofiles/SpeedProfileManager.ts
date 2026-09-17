/**
 * Learned per-edge speed profiles (fleetsim-all-1ajn.4): ties the observation
 * sources, the {@link SpeedProfileStore}, the simulation clock and routing.
 *
 * Flow:
 *  - Sources call {@link SpeedProfileManager.observe} with an edge's measured
 *    RUNNING speed (no node delay / turn time, see the sources): `sim` via the
 *    {@link TraversalRecorder} installed on `RouteManager`, `adapter` via
 *    {@link FixMatcher} fed by `POST /speed-profiles/observations`. Each lands
 *    in the bucket of its own timestamp (sim clock for `sim`, the fix time for
 *    `adapter`).
 *  - Routing reads a sparse table: learned speeds of the CURRENT bucket (by the
 *    sim clock) for edges with at least `minSamples` samples. It is published
 *    to `RoadNetwork.setSpeedOverrides` — main-thread engine AND every pool
 *    worker — lazily at route-request time (the network's route-request hook):
 *    immediately when the bucket changed, otherwise at most once per
 *    `publishIntervalMs` of simulated time while new samples are pending. That
 *    also works in the headless fast-forward, which runs no timers. Every
 *    publish bumps the network's profile version, which keys the route cache.
 *  - Edges without enough samples keep their static cost; so does everything
 *    when the feature is off (the manager is not even constructed then).
 *
 * Deliberately NOT applied to vehicle movement: the simulated vehicles are the
 * `sim` source, so feeding learned speeds back into how they drive would be a
 * feedback loop. For the same reason the time-of-day demand multipliers
 * (`utils/trafficProfiles`) need no special handling here: they only shape
 * movement (TrafficManager congestion, heat-zone intensity) and were never part
 * of the routing cost, so observations that include their effect are counted in
 * routing exactly once.
 */

import crypto from "crypto";
import type { Edge } from "../../types";
import type { RoadNetwork } from "../RoadNetwork";
import type { SpeedProfileRow, StateStore } from "../StateStore";
import { createLogger } from "../../utils/logger";
import { bucketOfTime, sameLayout, type BucketLayout } from "./buckets";
import { SpeedProfileStore, type ImportResult, type SpeedProfileFile } from "./SpeedProfileStore";
import { TraversalRecorder } from "./TraversalRecorder";
import { FixMatcher, type PositionFix } from "./FixMatcher";

const log = createLogger("SpeedProfiles");

/** StateStore meta key holding the SHA-256 of the last seed file merged in. */
export const SEED_HASH_META_KEY = "speed_profile_seed_sha256";

export type SpeedSource = "sim" | "adapter";

export interface SpeedProfileSettings {
  sources: SpeedSource[];
  layout: BucketLayout;
  minSamples: number;
  alpha: number;
  /** Min simulated ms between publishes of new samples (bucket changes publish at once). */
  publishIntervalMs: number;
}

/** The part of {@link RoadNetwork} the manager depends on. */
export type SpeedProfileNetwork = Pick<
  RoadNetwork,
  | "edgeCount"
  | "edgeIndexOf"
  | "edgeAt"
  | "getEdge"
  | "setSpeedOverrides"
  | "setRouteRequestHook"
  | "findNearestNode"
  | "getWeatherFactor"
>;

export interface SpeedProfileStats {
  sources: SpeedSource[];
  period: BucketLayout["period"];
  bucketHours: number;
  minSamples: number;
  currentBucket: number;
  observedEdges: number;
  totalSamples: number;
  /** Edges priced at a learned speed by the table routing currently uses. */
  activeOverrides: number;
  publishedBucket: number | null;
}

export class SpeedProfileManager {
  readonly store: SpeedProfileStore;
  /** The `sim` source, or null when it is not enabled. */
  readonly recorder: TraversalRecorder | null;
  /** The `adapter` source, or null when it is not enabled. */
  readonly fixMatcher: FixMatcher | null;

  private readonly sources: Set<SpeedSource>;
  private publishedBucket = -1;
  private lastPublishAt = 0;
  private activeOverrides = 0;
  private pending = false;
  /** Set by a replace-import or a layout change: the next save rewrites every row. */
  private rewriteAll = false;

  constructor(
    readonly network: SpeedProfileNetwork,
    private readonly settings: SpeedProfileSettings,
    private readonly now: () => number
  ) {
    this.sources = new Set(settings.sources);
    this.store = new SpeedProfileStore(network.edgeCount, settings.layout, settings.alpha);
    this.recorder = this.sources.has("sim")
      ? new TraversalRecorder((edge, speed) => {
          this.observe(edge, speed, this.now(), "sim");
        })
      : null;
    this.fixMatcher = this.sources.has("adapter")
      ? new FixMatcher(network, (edge, speed, atMs) => {
          this.observe(edge, speed, atMs, "adapter");
        })
      : null;
  }

  /** Hooks {@link refresh} into every route request on the network. */
  install(): void {
    this.network.setRouteRequestHook(() => this.refresh());
  }

  /**
   * Records one running-speed observation. Returns false when the source is
   * disabled, the edge is not a graph edge (e.g. a synthetic U-turn) or the
   * speed is unusable.
   *
   * NORMALISED to clear-weather speed before storing (fleetsim-all-1ajn.5):
   * divided by the weather factor in effect right now. Without this, an
   * observation recorded while it's raining already contains the weather
   * slowdown, and routing/estimateTo would then apply the (live) weather
   * factor AGAIN on top of the learned speed — double-counting it every time
   * the bucket that got rained on is active. Dividing it back out here makes
   * the stored speed represent what the edge runs at in clear weather, so
   * `applyDynamicCost`/`RouteManager` can keep applying the weather factor
   * uniformly to every edge (learned or static) exactly once.
   *
   * This uses the CURRENT weather factor, not the factor AT `atMs`: the `sim`
   * source calls this essentially in real time (no weather history), so the
   * two coincide for it; for the `adapter` source (fixes may arrive batched
   * or after the fact) this is an approximation — there is no weather history
   * to look up instead. Good enough given weather changes far slower than the
   * poll interval; a real history would need timestamped weather to fix.
   */
  observe(edge: Edge, speedKmh: number, atMs: number, source: SpeedSource): boolean {
    if (!this.sources.has(source)) return false;
    const index = this.network.edgeIndexOf(edge);
    if (index < 0) return false;
    const weatherFactor = this.network.getWeatherFactor();
    const clearWeatherSpeed = weatherFactor > 0 ? speedKmh / weatherFactor : speedKmh;
    const ok = this.store.record(
      index,
      bucketOfTime(this.settings.layout, atMs),
      clearWeatherSpeed
    );
    if (ok) this.pending = true;
    return ok;
  }

  /**
   * Feeds real position fixes through the map matcher. Returns null when the
   * `adapter` source is not enabled.
   */
  ingestFixes(fixes: PositionFix[]): { fixes: number; observations: number } | null {
    if (!this.fixMatcher) return null;
    const sorted = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
    let observations = 0;
    for (const fix of sorted) if (this.fixMatcher.ingest(fix)) observations++;
    return { fixes: fixes.length, observations };
  }

  /**
   * Publishes the current bucket's table when the bucket changed, or when new
   * samples are pending and the publish interval has elapsed. Returns whether it
   * published.
   */
  refresh(): boolean {
    const now = this.now();
    const bucket = bucketOfTime(this.settings.layout, now);
    const due =
      this.pending &&
      (now - this.lastPublishAt >= this.settings.publishIntervalMs || now < this.lastPublishAt);
    if (bucket === this.publishedBucket && !due) return false;
    this.publishBucket(bucket, now);
    return true;
  }

  /** Publishes the current bucket's table unconditionally. */
  publish(): void {
    const now = this.now();
    this.publishBucket(bucketOfTime(this.settings.layout, now), now);
  }

  stats(): SpeedProfileStats {
    return {
      sources: [...this.sources],
      period: this.settings.layout.period,
      bucketHours: this.settings.layout.bucketHours,
      minSamples: this.settings.minSamples,
      currentBucket: bucketOfTime(this.settings.layout, this.now()),
      observedEdges: this.store.observedEdgeCount,
      totalSamples: this.store.totalSamples,
      activeOverrides: this.activeOverrides,
      publishedBucket: this.publishedBucket >= 0 ? this.publishedBucket : null,
    };
  }

  // ─── Export / import ──────────────────────────────────────────────

  exportFile(): SpeedProfileFile {
    return this.store.toFile((i) => {
      const edge = this.network.edgeAt(i)!;
      return { id: edge.id, way: edge.streetId };
    });
  }

  /**
   * Merges (`merge`) or replaces (`replace`) the learned profiles with a file's,
   * then publishes so routing uses it immediately.
   */
  importFile(file: SpeedProfileFile, mode: "merge" | "replace"): ImportResult {
    if (mode === "replace") {
      this.store.clear();
      this.rewriteAll = true;
    }
    const result = this.store.importFile(file, (id) => this.indexOfId(id));
    this.publish();
    return result;
  }

  /**
   * Merges a seed file (`SPEED_PROFILE_SEED_FILE`) at boot — ONCE per content.
   * Merging adds the file's sample counts, and persisted rows already contain
   * a previous merge, so re-applying the same file on every restart would keep
   * inflating counts. With a state store the content hash is recorded and an
   * already-applied file is skipped; a changed file is applied once. Without a
   * store nothing persists between boots, so the seed is always applied. The
   * merged rows are saved right away so the recorded hash never outlives them.
   */
  applySeedFile(
    content: string,
    stateStore?: StateStore
  ): { applied: boolean; result?: ImportResult } {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    if (stateStore && stateStore.getMeta(SEED_HASH_META_KEY) === hash) {
      return { applied: false };
    }
    const result = this.importFile(JSON.parse(content) as SpeedProfileFile, "merge");
    if (stateStore) {
      this.saveTo(stateStore);
      stateStore.setMeta(SEED_HASH_META_KEY, hash);
    }
    return { applied: true, result };
  }

  // ─── Persistence ──────────────────────────────────────────────────

  /**
   * Writes every edge changed since the last save (or all of them after a
   * replace-import / layout change). Returns the number of rows written.
   */
  saveTo(stateStore: StateStore): number {
    const indices = this.rewriteAll ? this.allObserved() : this.store.takeDirty();
    if (this.rewriteAll) {
      stateStore.clearSpeedProfiles();
      this.store.takeDirty();
      this.rewriteAll = false;
    }
    const rows: SpeedProfileRow[] = [];
    for (const i of indices) {
      const row = this.store.row(i);
      const edge = this.network.edgeAt(i);
      if (!row || !edge) continue;
      rows.push({
        edgeId: edge.id,
        wayId: edge.streetId || null,
        period: this.settings.layout.period,
        bucketHours: this.settings.layout.bucketHours,
        speeds: row.speeds,
        counts: row.counts,
      });
    }
    if (rows.length > 0) stateStore.upsertSpeedProfiles(rows);
    return rows.length;
  }

  /**
   * Loads persisted profiles, re-bucketing rows recorded under another layout,
   * and publishes. Rows for edges this network no longer has are skipped.
   */
  loadFrom(stateStore: StateStore): { rows: number; unmatched: number } {
    let rows = 0;
    let unmatched = 0;
    for (const row of stateStore.loadSpeedProfiles()) {
      const index = this.indexOfId(row.edgeId);
      if (index < 0) {
        unmatched++;
        continue;
      }
      const from = { period: row.period, bucketHours: row.bucketHours };
      try {
        this.store.importRow(index, from, row.speeds, row.counts);
      } catch (err) {
        log.warn(`Skipping speed profile row ${row.edgeId}: ${(err as Error).message}`);
        continue;
      }
      if (!sameLayout(from, this.settings.layout)) this.rewriteAll = true;
      rows++;
    }
    // Loaded rows are already persisted; only a layout change needs a rewrite.
    this.store.takeDirty();
    if (rows > 0 || unmatched > 0) {
      log.info(`Loaded ${rows} speed profile row(s), ${unmatched} for edges not in this network`);
    }
    this.publish();
    return { rows, unmatched };
  }

  // ─── Internals ────────────────────────────────────────────────────

  private publishBucket(bucket: number, now: number): void {
    const table = this.store.overridesFor(bucket, this.settings.minSamples);
    this.network.setSpeedOverrides(table);
    this.activeOverrides = table.indices.length;
    this.publishedBucket = bucket;
    this.lastPublishAt = now;
    this.pending = false;
  }

  private indexOfId(edgeId: string): number {
    const edge = this.network.getEdge(edgeId);
    return edge ? this.network.edgeIndexOf(edge) : -1;
  }

  private allObserved(): number[] {
    const out: number[] = [];
    this.store.forEachObserved((i) => out.push(i));
    return out;
  }
}

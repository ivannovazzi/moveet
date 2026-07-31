/**
 * ALT (A*, Landmarks, Triangle inequality) preprocessing and heuristic, shared
 * by the main-thread {@link PathfindingEngine} and the pathfinding worker.
 *
 * ## Why ALT and not contraction hierarchies
 *
 * A* here is *dynamically weighted*: an incident can raise an edge's cost (or
 * remove it entirely) at any moment, and per-vehicle `restrictedHighways`
 * profiles delete whole road classes from the search. Contraction hierarchies
 * bake the metric into a shortcut graph, so every one of those events would
 * invalidate the hierarchy — recovering that needs customizable CH / CRP, a much
 * larger and far riskier change. ALT needs no such thing: its bounds are derived
 * from a *lower-bounding* metric, so they stay valid under any change that only
 * ever makes the graph more expensive. See "Admissibility" below.
 *
 * ## The bound
 *
 * For each landmark `L` we precompute, over the STATIC base edge cost only:
 *   - `distFrom[L][v]` — cost of the cheapest path L → v
 *   - `distTo[L][v]`   — cost of the cheapest path v → L
 *
 * The triangle inequality then gives, for any v and target t:
 *   d(v,t) >= distFrom[L][t] - distFrom[L][v]      (paths out of L)
 *   d(v,t) >= distTo[L][v]   - distTo[L][t]        (paths into L)
 *
 * The heuristic is the maximum over all landmarks and both directions, floored
 * at 0. It is combined (via `max`) with the pre-existing haversine bound in the
 * callers: the max of two admissible+consistent heuristics is itself admissible
 * and consistent, and the haversine term keeps a useful bound for nodes that no
 * landmark can reach (small disconnected components).
 *
 * ## Admissibility under dynamic costs — verified against the code
 *
 * Preprocessing uses `edgeBaseCost` (GraphBuilder) / `edge.baseTravelTime`
 * (worker), i.e. exactly `computeBaseTravelTime`, and skips `smoothnessFactor
 * === 0` edges just as A* does. Every runtime term the A* loop adds on top can
 * only INCREASE an edge's cost or delete the edge:
 *   - incident factor: `applyDynamicCost` divides only when `factor < 1`, so the
 *     cost never shrinks; `factor === 0` is a closure and the edge is skipped.
 *   - traffic-signal delay: `+ SIGNAL_DELAY_H`, never negative.
 *   - turn restrictions / `restrictedHighways`: delete transitions or edges.
 * Deleting edges and raising costs can only raise the true shortest-path cost,
 * so a bound computed on the base metric remains a valid lower bound. There is
 * no code path that reduces an edge below its base cost.
 *
 * Consistency (needed because the A* here uses a closed set and never reopens):
 * each individual term differs by at most the base distance between two nodes,
 * `d_base(u,v) <= baseCost(u,v) <= actualCost(u,v)`, and `max` of consistent
 * heuristics is consistent.
 *
 * ## Determinism
 *
 * Node array indices are assigned in sorted-node-id order and the landmark
 * selection (farthest-point) breaks ties on the lowest index, so the main thread
 * and every worker independently derive the SAME landmark set from the same
 * GeoJSON without having to ship anything between them. Identical heuristics on
 * both sides mean identical A* expansion order, which is what keeps the
 * main-thread/worker route-equivalence guarantee intact.
 */

import { NumericHeap } from "./heap";

/** Landmarks used when `PATHFINDING_LANDMARKS` is unset. */
export const DEFAULT_LANDMARK_COUNT = 4;
/** Hard ceiling — preprocessing cost and memory are both linear in this. */
export const MAX_LANDMARK_COUNT = 32;

/**
 * Parses and clamps a raw `PATHFINDING_LANDMARKS` value.
 *
 * `0` disables ALT entirely and restores the pure-haversine heuristic; blank,
 * malformed and negative values fall back to the default; anything above
 * {@link MAX_LANDMARK_COUNT} is clamped rather than rejected.
 *
 * This lives beside the constants that define the range and is called by the
 * zod env schema in `utils/config.ts` — the ONE place the variable is read from
 * the environment. The dependency deliberately runs config → landmarks and never
 * the reverse: this module is bundled into the pathfinding worker (esbuild),
 * which must stay free of zod/dotenv/pino. The worker is handed the resolved
 * number through `workerData` (see `PathfindingPool`), so nothing on this side
 * of the boundary touches `process.env`.
 */
export function resolveLandmarkCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LANDMARK_COUNT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LANDMARK_COUNT;
  return Math.min(parsed, MAX_LANDMARK_COUNT);
}

/**
 * Structural mixin stamped onto graph nodes at build time so the heuristic can
 * index the landmark distance arrays directly instead of hashing a string key
 * on every relaxation. Declared here (rather than on the shared `Node` type)
 * to keep the optimisation self-contained within the pathfinding module.
 */
export interface AltIndexed {
  /** Index into the landmark distance arrays, or `undefined` when unindexed. */
  altIndex?: number;
}

/** Compressed-sparse-row adjacency used only during preprocessing. */
export interface CsrGraph {
  nodeCount: number;
  /** Length `nodeCount + 1`; edges of node `i` are `[offsets[i], offsets[i+1])`. */
  offsets: Int32Array;
  targets: Int32Array;
  weights: Float64Array;
}

/** Precomputed landmark distance tables. */
export interface LandmarkIndex {
  /** Number of landmarks actually built (may be less than requested on tiny graphs). */
  count: number;
  nodeCount: number;
  /** `distFrom[l * nodeCount + v]` — base cost of landmark `l` → node `v`. */
  distFrom: Float64Array;
  /** `distTo[l * nodeCount + v]` — base cost of node `v` → landmark `l`. */
  distTo: Float64Array;
  /** Node indices chosen as landmarks, in selection order. */
  landmarks: Int32Array;
}

/**
 * Assigns dense array indices to node ids in sorted order.
 *
 * Sorting (rather than using the graph's insertion order) is what makes the
 * main thread and the worker agree on indices — and therefore on the selected
 * landmarks — without exchanging any data.
 */
export function sortedNodeIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

/**
 * Builds the forward and reverse CSR adjacency from parallel edge arrays.
 *
 * @param nodeCount total nodes
 * @param from      per-edge source node index
 * @param to        per-edge target node index
 * @param weight    per-edge base cost
 * @param edgeCount number of valid entries at the head of the arrays
 */
export function buildCsrPair(
  nodeCount: number,
  from: Int32Array,
  to: Int32Array,
  weight: Float64Array,
  edgeCount: number
): { forward: CsrGraph; reverse: CsrGraph } {
  const forward = buildCsr(nodeCount, from, to, weight, edgeCount);
  const reverse = buildCsr(nodeCount, to, from, weight, edgeCount);
  return { forward, reverse };
}

function buildCsr(
  nodeCount: number,
  from: Int32Array,
  to: Int32Array,
  weight: Float64Array,
  edgeCount: number
): CsrGraph {
  const offsets = new Int32Array(nodeCount + 1);
  for (let e = 0; e < edgeCount; e++) offsets[from[e] + 1]++;
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] += offsets[i];

  const targets = new Int32Array(edgeCount);
  const weights = new Float64Array(edgeCount);
  const cursor = offsets.slice(0, nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    const slot = cursor[from[e]]++;
    targets[slot] = to[e];
    weights[slot] = weight[e];
  }
  return { nodeCount, offsets, targets, weights };
}

/**
 * Single-source Dijkstra over a CSR graph, writing into `out[offset .. offset+n)`.
 * Unreachable nodes are left at `Infinity`.
 */
function dijkstra(
  graph: CsrGraph,
  source: number,
  out: Float64Array,
  offset: number,
  heap: NumericHeap
): void {
  const n = graph.nodeCount;
  out.fill(Infinity, offset, offset + n);
  out[offset + source] = 0;
  heap.clear();
  heap.push(source, 0);

  const { offsets, targets, weights } = graph;
  while (heap.size > 0) {
    const key = heap.peekKey();
    const u = heap.pop();
    // Lazy deletion: skip entries superseded by a cheaper push.
    if (key > out[offset + u]) continue;
    const end = offsets[u + 1];
    for (let i = offsets[u]; i < end; i++) {
      const v = targets[i];
      const candidate = key + weights[i];
      if (candidate < out[offset + v]) {
        out[offset + v] = candidate;
        heap.push(v, candidate);
      }
    }
  }
}

/**
 * Selects landmarks with the standard farthest-point heuristic and precomputes
 * both distance tables.
 *
 * Selection: seed at node index 0 (the lexicographically smallest node id) and
 * take the node farthest from it as the first landmark; each subsequent
 * landmark is the node maximising its distance to the closest landmark chosen
 * so far. "Distance to a landmark" is the larger of the two directed distances,
 * so a node counts as well covered only when it is close to the landmark BOTH
 * ways. Unreachable nodes count as distance 0 so a handful of nodes in a tiny
 * disconnected component cannot capture a landmark; those nodes simply fall back
 * to the haversine bound. Already-chosen nodes are excluded, so landmarks are
 * always distinct.
 *
 * Cost: `2 * count + 1` full-graph Dijkstras, and
 * `2 * count * nodeCount * 8` bytes of `Float64Array`.
 *
 * @returns the index, or `null` when landmarks are disabled or unusable.
 */
export function buildLandmarkIndex(
  forward: CsrGraph,
  reverse: CsrGraph,
  requested: number
): LandmarkIndex | null {
  const nodeCount = forward.nodeCount;
  const count = Math.min(requested, nodeCount);
  if (count <= 0 || nodeCount <= 0) return null;

  const distFrom = new Float64Array(count * nodeCount);
  const distTo = new Float64Array(count * nodeCount);
  const landmarks = new Int32Array(count);
  const heap = new NumericHeap(Math.min(nodeCount, 1 << 16));
  const scratch = new Float64Array(nodeCount);
  const closest = new Float64Array(nodeCount).fill(Infinity);
  const taken = new Uint8Array(nodeCount);

  // Seed: farthest node from index 0 (the lexicographically smallest node id).
  dijkstra(forward, 0, scratch, 0, heap);
  landmarks[0] = pickFarthest(scratch, taken, nodeCount);
  taken[landmarks[0]] = 1;

  for (let l = 0; l < count; l++) {
    const base = l * nodeCount;
    dijkstra(forward, landmarks[l], distFrom, base, heap);
    dijkstra(reverse, landmarks[l], distTo, base, heap);

    if (l + 1 < count) {
      for (let v = 0; v < nodeCount; v++) {
        const out = distFrom[base + v];
        const back = distTo[base + v];
        // Unreachable counts as 0 so tiny disconnected components cannot
        // capture a landmark; a node is "covered" only when close both ways.
        const outFinite = out === Infinity ? 0 : out;
        const backFinite = back === Infinity ? 0 : back;
        const separation = outFinite > backFinite ? outFinite : backFinite;
        if (separation < closest[v]) closest[v] = separation;
      }
      const next = pickFarthest(closest, taken, nodeCount);
      landmarks[l + 1] = next;
      taken[next] = 1;
    }
  }

  return { count, nodeCount, distFrom, distTo, landmarks };
}

/**
 * Index of the largest finite value in `arr[0 .. n)`, skipping nodes already
 * chosen. Ties break on the lowest index, which — because indices come from the
 * sorted node ids — makes selection deterministic across processes.
 */
function pickFarthest(arr: Float64Array, taken: Uint8Array, n: number): number {
  let best = -1;
  let bestValue = -1;
  for (let i = 0; i < n; i++) {
    if (taken[i]) continue;
    const value = arr[i];
    if (value !== Infinity && value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  if (best >= 0) return best;
  // Every remaining node is Infinity-valued (or none remain): fall back to the
  // first untaken index so landmarks stay distinct.
  for (let i = 0; i < n; i++) if (!taken[i]) return i;
  return 0;
}

/**
 * Per-search view of a {@link LandmarkIndex}, specialised to one target node.
 *
 * `setTarget` collects the landmarks that actually bound this target into two
 * compact lists, so {@link bound} is a short branch-light loop over typed arrays
 * with no `Infinity` checks on the hot side. Reused across searches — a single
 * instance per engine/worker, since each A* run is synchronous.
 */
export class AltHeuristic {
  private readonly index: LandmarkIndex;
  /** Row offsets (`l * nodeCount`) of landmarks bounding the target from L. */
  private readonly fromRows: Int32Array;
  /** `distFrom[l][target]` matching `fromRows`. */
  private readonly fromTarget: Float64Array;
  /** Row offsets of landmarks bounding the target towards L. */
  private readonly toRows: Int32Array;
  /** `distTo[l][target]` matching `toRows`. */
  private readonly toTarget: Float64Array;
  private fromCount = 0;
  private toCount = 0;
  /** False when the current target cannot be bounded at all (callers use haversine). */
  private ready = false;

  constructor(index: LandmarkIndex) {
    this.index = index;
    this.fromRows = new Int32Array(index.count);
    this.fromTarget = new Float64Array(index.count);
    this.toRows = new Int32Array(index.count);
    this.toTarget = new Float64Array(index.count);
  }

  /**
   * Point the heuristic at a target node index.
   *
   * @returns whether any landmark can bound this target.
   */
  setTarget(target: number | undefined): boolean {
    this.fromCount = 0;
    this.toCount = 0;
    this.ready = false;
    if (target === undefined || target < 0 || target >= this.index.nodeCount) return false;

    const { count, nodeCount, distFrom, distTo } = this.index;
    for (let l = 0; l < count; l++) {
      const row = l * nodeCount;
      // Only landmarks that can REACH the target bound `distFrom[L][t] - distFrom[L][v]`;
      // an infinite minuend would produce a bogus infinite bound.
      const dLt = distFrom[row + target];
      if (dLt !== Infinity) {
        this.fromRows[this.fromCount] = row;
        this.fromTarget[this.fromCount] = dLt;
        this.fromCount++;
      }
      // Symmetrically for `distTo[L][v] - distTo[L][t]`.
      const dtL = distTo[row + target];
      if (dtL !== Infinity) {
        this.toRows[this.toCount] = row;
        this.toTarget[this.toCount] = dtL;
        this.toCount++;
      }
    }
    this.ready = this.fromCount > 0 || this.toCount > 0;
    return this.ready;
  }

  /** Whether {@link bound} is meaningful for the current target. */
  get active(): boolean {
    return this.ready;
  }

  /**
   * Lower bound on the base-metric cost from node index `v` to the current
   * target. Returns 0 — trivially admissible — when nothing applies.
   *
   * Two edge cases are deliberate:
   *
   *  - `distFrom[L][v] === Infinity` (the landmark cannot reach `v`) yields
   *    `-Infinity`, which loses to the 0 floor. Correct: `L` failing to reach
   *    `v` says nothing about whether `v` reaches the target.
   *  - `distTo[L][v] === Infinity` while `distTo[L][target]` is finite yields
   *    `+Infinity`, and that is CORRECT rather than a bug: if `v` cannot reach
   *    `L` but the target can, then `v` cannot reach the target either (a path
   *    v → target → L would contradict it). The preprocessing graph is a
   *    superset of the graph A* searches — incidents, closures, turn
   *    restrictions and highway filters only ever REMOVE arcs — so
   *    unreachable-here implies unreachable-there. Such nodes sort to the back
   *    of the frontier and are never expanded ahead of a real candidate. The
   *    `Infinity` also cannot break consistency: every A* successor of such a
   *    node is unreachable to `L` too, so the bound never drops from infinite
   *    to finite across an arc.
   */
  bound(v: number): number {
    if (v < 0 || v >= this.index.nodeCount) return 0;
    const { distFrom, distTo } = this.index;
    let best = 0;
    for (let i = 0; i < this.fromCount; i++) {
      const candidate = this.fromTarget[i] - distFrom[this.fromRows[i] + v];
      if (candidate > best) best = candidate;
    }
    for (let i = 0; i < this.toCount; i++) {
      const candidate = distTo[this.toRows[i] + v] - this.toTarget[i];
      if (candidate > best) best = candidate;
    }
    return best;
  }
}

/** Bytes of heap held by a landmark index (the two `Float64Array` tables). */
export function landmarkIndexBytes(index: LandmarkIndex | null): number {
  if (!index) return 0;
  return index.distFrom.byteLength + index.distTo.byteLength;
}

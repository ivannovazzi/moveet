/**
 * Reusable per-graph scratch space for the edge-based A* shared in shape by the
 * main-thread `PathfindingEngine` and the worker.
 *
 * An edge-based search has ~2x the states of a node-based one, so per-search
 * `Map`/`Set` bookkeeping keyed by edge-id strings (and one heap object per
 * push) became the dominant cost. Instead every edge and node gets a dense
 * integer index once, at engine/graph construction, and a search reads and
 * writes typed arrays. Entries are validated by a per-search stamp, so starting
 * a new search is O(1) — nothing is cleared.
 *
 * Not re-entrant: one search at a time per scratch (both A* loops are
 * synchronous).
 */

import { NumericHeap } from "./heap";

export class EdgeSearchScratch {
  /** Best known cost (hours) to have arrived via edge i; valid when `gStamp[i] === search`. */
  readonly g: Float64Array;
  readonly gStamp: Uint32Array;
  /** Edge i has been expanded when `closedStamp[i] === search`. */
  readonly closedStamp: Uint32Array;
  /** Index of the edge before edge i on its best path, or -1 for a first edge. */
  readonly prev: Int32Array;
  /** Cached heuristic for node i; valid when `hStamp[i] === search`. */
  readonly h: Float64Array;
  readonly hStamp: Uint32Array;
  /** Frontier over edge indices, keyed by f = g + h. */
  readonly heap: NumericHeap;
  private stamp = 0;

  constructor(edgeCount: number, nodeCount: number) {
    this.g = new Float64Array(edgeCount);
    this.gStamp = new Uint32Array(edgeCount);
    this.closedStamp = new Uint32Array(edgeCount);
    this.prev = new Int32Array(edgeCount);
    this.h = new Float64Array(nodeCount);
    this.hStamp = new Uint32Array(nodeCount);
    this.heap = new NumericHeap(1024);
  }

  /** Starts a new search and returns its stamp (always >= 1). */
  begin(): number {
    this.heap.clear();
    if (this.stamp === 0xffffffff) {
      this.gStamp.fill(0);
      this.closedStamp.fill(0);
      this.hStamp.fill(0);
      this.stamp = 0;
    }
    return ++this.stamp;
  }
}

/**
 * Shared binary min-heaps used by the pathfinding code.
 *
 * - {@link PathNodeHeap} — the A* frontier, keyed on `fScore`. Extracted so the
 *   main-thread {@link RoadNetwork} A* and the
 *   {@link "../../workers/pathfinding-worker"} A* use the exact same heap
 *   implementation instead of two hand-synced copies that could drift.
 * - {@link NumericHeap} — a typed-array (int id, float key) heap used by the ALT
 *   landmark preprocessing Dijkstras, where node ids are dense integer indices
 *   and allocating one object per queue entry would dominate the runtime.
 */

export interface PathNode {
  id: string;
  gScore: number;
  fScore: number;
}

/** Binary min-heap ordered by `fScore` (smallest first). */
export class PathNodeHeap {
  private heap: PathNode[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: PathNode): void {
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].fScore <= heap[i].fScore) break;
      const tmp = heap[parent];
      heap[parent] = heap[i];
      heap[i] = tmp;
      i = parent;
    }
  }

  pop(): PathNode {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      for (;;) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < n && heap[left].fScore < heap[smallest].fScore) smallest = left;
        if (right < n && heap[right].fScore < heap[smallest].fScore) smallest = right;
        if (smallest === i) break;
        const tmp = heap[i];
        heap[i] = heap[smallest];
        heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Binary min-heap over `(int32 id, float64 key)` pairs backed by typed arrays.
 *
 * Used by the ALT landmark preprocessing (see `landmarks.ts`), which runs one
 * Dijkstra per landmark over the whole graph — hundreds of thousands of pushes
 * where the per-entry object allocation of {@link PathNodeHeap} would dominate.
 * Entries are stale-checked by the caller (lazy deletion), so there is no
 * decrease-key operation.
 */
export class NumericHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  private n = 0;

  constructor(initialCapacity = 1024) {
    const cap = Math.max(1, initialCapacity);
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }

  get size(): number {
    return this.n;
  }

  /** Drop every entry without releasing the backing arrays (so they can be reused). */
  clear(): void {
    this.n = 0;
  }

  /** Key of the smallest entry. Only valid when `size > 0`. */
  peekKey(): number {
    return this.keys[0];
  }

  private grow(): void {
    const nextIds = new Int32Array(this.ids.length * 2);
    nextIds.set(this.ids);
    this.ids = nextIds;
    const nextKeys = new Float64Array(this.keys.length * 2);
    nextKeys.set(this.keys);
    this.keys = nextKeys;
  }

  push(id: number, key: number): void {
    if (this.n === this.ids.length) this.grow();
    const ids = this.ids;
    const keys = this.keys;
    let i = this.n++;
    ids[i] = id;
    keys[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      const tmpId = ids[parent];
      ids[parent] = ids[i];
      ids[i] = tmpId;
      const tmpKey = keys[parent];
      keys[parent] = keys[i];
      keys[i] = tmpKey;
      i = parent;
    }
  }

  /** Remove and return the id of the smallest entry. Only valid when `size > 0`. */
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const n = --this.n;
    ids[0] = ids[n];
    keys[0] = keys[n];
    let i = 0;
    for (;;) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && keys[left] < keys[smallest]) smallest = left;
      if (right < n && keys[right] < keys[smallest]) smallest = right;
      if (smallest === i) break;
      const tmpId = ids[smallest];
      ids[smallest] = ids[i];
      ids[i] = tmpId;
      const tmpKey = keys[smallest];
      keys[smallest] = keys[i];
      keys[i] = tmpKey;
      i = smallest;
    }
    return top;
  }
}

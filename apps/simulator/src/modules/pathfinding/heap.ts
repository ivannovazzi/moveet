/**
 * Shared binary min-heap of A* path nodes, keyed on `fScore`.
 *
 * Extracted so the main-thread {@link RoadNetwork} A* and the
 * {@link "../../workers/pathfinding-worker"} A* use the exact same heap
 * implementation instead of two hand-synced copies that could drift.
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

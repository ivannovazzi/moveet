/**
 * A fixed-size circular buffer with O(1) lookups via a backing Set.
 * When the buffer is full, adding a new item evicts the oldest entry.
 * This avoids the GC spikes caused by clearing a Set that grew to capacity.
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private index: number = 0;
  private readonly lookup: Set<T> = new Set();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  add(item: T): void {
    if (this.lookup.has(item)) return; // already tracked

    // If buffer is full, remove the oldest entry from the lookup set
    const evicted = this.buffer[this.index];
    if (evicted !== undefined) {
      this.lookup.delete(evicted);
    }

    this.buffer[this.index] = item;
    this.lookup.add(item);
    this.index = (this.index + 1) % this.capacity;
  }

  has(item: T): boolean {
    return this.lookup.has(item);
  }

  get size(): number {
    return this.lookup.size;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.index = 0;
    this.lookup.clear();
  }
}

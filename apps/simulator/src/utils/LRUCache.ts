/**
 * A generic Least Recently Used (LRU) cache with optional TTL expiry.
 *
 * Uses a Map to maintain insertion/access order (Map iterates in insertion order)
 * and re-inserts entries on access to move them to the "most recent" position.
 *
 * @typeParam T - The type of cached values
 */

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

export interface LRUCacheOptions {
  /** Maximum number of entries in the cache */
  maxSize: number;
  /** Time-to-live in milliseconds. Entries older than this are considered stale. 0 = no expiry. */
  ttlMs: number;
}

const DEFAULT_OPTIONS: LRUCacheOptions = {
  maxSize: 500,
  ttlMs: 60_000,
};

export class LRUCache<T> {
  private readonly entries: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  private hitCount = 0;
  private missCount = 0;

  constructor(options: Partial<LRUCacheOptions> = {}) {
    const resolved = { ...DEFAULT_OPTIONS, ...options };
    this.maxSize = resolved.maxSize;
    this.ttlMs = resolved.ttlMs;
  }

  /**
   * Retrieve a value from the cache.
   * Returns undefined on miss or if the entry has expired.
   * On a valid hit, the entry is promoted to most-recently-used.
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      this.missCount++;
      return undefined;
    }

    // Check TTL expiry
    if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key);
      this.missCount++;
      return undefined;
    }

    // Promote to most-recently-used by re-inserting
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hitCount++;

    return entry.value;
  }

  /**
   * Store a value in the cache. If the cache is full, the least recently used
   * entry is evicted first.
   */
  set(key: string, value: T): void {
    // If key already exists, delete first so the new entry lands at the end
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.entries.size >= this.maxSize) {
      // Map iterator yields entries in insertion order; first key = LRU
      const lruKey = this.entries.keys().next().value;
      if (lruKey !== undefined) {
        this.entries.delete(lruKey);
      }
    }

    this.entries.set(key, { value, createdAt: Date.now() });
  }

  /** Remove all entries and reset stats. */
  clear(): void {
    this.entries.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /** Return current cache statistics. */
  stats(): CacheStats {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.entries.size,
      maxSize: this.maxSize,
    };
  }

  /** Current number of entries in the cache. */
  get size(): number {
    return this.entries.size;
  }

  /** Check whether a key exists and is not expired (without promoting it). */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.ttlMs > 0 && Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a specific entry. Returns true if it existed. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }
}

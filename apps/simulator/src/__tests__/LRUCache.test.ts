import { describe, it, expect, beforeEach, vi } from "vitest";
import { LRUCache } from "../utils/LRUCache";

describe("LRUCache", () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>({ maxSize: 3, ttlMs: 1000 });
  });

  describe("get / set basics", () => {
    it("should return undefined for a missing key", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("should store and retrieve a value", () => {
      cache.set("a", "alpha");
      expect(cache.get("a")).toBe("alpha");
    });

    it("should overwrite an existing key", () => {
      cache.set("a", "alpha");
      cache.set("a", "ALPHA");
      expect(cache.get("a")).toBe("ALPHA");
      expect(cache.size).toBe(1);
    });
  });

  describe("LRU eviction", () => {
    it("should evict the least recently used entry when full", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");

      // Cache is full (maxSize=3). Adding a fourth entry evicts "a".
      cache.set("d", "4");

      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
      expect(cache.size).toBe(3);
    });

    it("should promote accessed entries so they are not evicted first", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");

      // Access "a" to promote it — now "b" is the LRU.
      cache.get("a");

      cache.set("d", "4");

      expect(cache.get("b")).toBeUndefined(); // evicted
      expect(cache.get("a")).toBe("1"); // promoted, still present
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
    });

    it("should not exceed maxSize", () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, `val-${i}`);
      }
      expect(cache.size).toBe(3);
    });
  });

  describe("TTL expiry", () => {
    it("should return value before TTL expires", () => {
      cache.set("a", "alpha");
      expect(cache.get("a")).toBe("alpha");
    });

    it("should return undefined after TTL expires", () => {
      vi.useFakeTimers();
      try {
        cache.set("a", "alpha");
        expect(cache.get("a")).toBe("alpha");

        // Advance past TTL (1000ms)
        vi.advanceTimersByTime(1001);

        expect(cache.get("a")).toBeUndefined();
        expect(cache.size).toBe(0); // entry removed on expired access
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not expire entries when ttlMs is 0", () => {
      vi.useFakeTimers();
      try {
        const noTtl = new LRUCache<string>({ maxSize: 3, ttlMs: 0 });
        noTtl.set("a", "alpha");

        vi.advanceTimersByTime(999_999);

        expect(noTtl.get("a")).toBe("alpha");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("has", () => {
    it("should return true for existing non-expired key", () => {
      cache.set("a", "alpha");
      expect(cache.has("a")).toBe(true);
    });

    it("should return false for missing key", () => {
      expect(cache.has("missing")).toBe(false);
    });

    it("should return false for expired key", () => {
      vi.useFakeTimers();
      try {
        cache.set("a", "alpha");
        vi.advanceTimersByTime(1001);
        expect(cache.has("a")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("delete", () => {
    it("should remove an entry", () => {
      cache.set("a", "alpha");
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("should return false for non-existent key", () => {
      expect(cache.delete("nope")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all entries and reset stats", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.get("a"); // hit
      cache.get("missing"); // miss

      cache.clear();

      expect(cache.size).toBe(0);

      // Stats are reset immediately after clear
      const stats = cache.stats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);

      // Subsequent lookups start counting from zero
      expect(cache.get("a")).toBeUndefined(); // miss
      expect(cache.stats().misses).toBe(1);
    });
  });

  describe("stats", () => {
    it("should track hits and misses", () => {
      cache.set("a", "1");

      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("missing"); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(3);
    });

    it("should count expired lookups as misses", () => {
      vi.useFakeTimers();
      try {
        cache.set("a", "1");
        vi.advanceTimersByTime(1001);
        cache.get("a"); // miss (expired)

        expect(cache.stats().misses).toBe(1);
        expect(cache.stats().hits).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("default options", () => {
    it("should use sensible defaults when no options provided", () => {
      const defaultCache = new LRUCache<number>();
      const stats = defaultCache.stats();
      expect(stats.maxSize).toBe(500);
    });
  });
});

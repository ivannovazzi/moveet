import { describe, it, expect } from "vitest";
import { CircularBuffer } from "../utils/CircularBuffer";

describe("CircularBuffer", () => {
  // ─── Basic add/has ──────────────────────────────────────────────

  describe("basic add/has", () => {
    it("should return true for added items", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");
      buf.add("b");
      buf.add("c");

      expect(buf.has("a")).toBe(true);
      expect(buf.has("b")).toBe(true);
      expect(buf.has("c")).toBe(true);
    });

    it("should return false for items not added", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");

      expect(buf.has("b")).toBe(false);
      expect(buf.has("z")).toBe(false);
    });
  });

  // ─── Capacity limit / eviction ─────────────────────────────────

  describe("capacity limit", () => {
    it("should evict the oldest item when capacity is exceeded", () => {
      const buf = new CircularBuffer<string>(3);
      buf.add("a"); // index 0
      buf.add("b"); // index 1
      buf.add("c"); // index 2 — buffer is now full

      // Adding a 4th item should evict "a"
      buf.add("d");

      expect(buf.has("a")).toBe(false);
      expect(buf.has("b")).toBe(true);
      expect(buf.has("c")).toBe(true);
      expect(buf.has("d")).toBe(true);
      expect(buf.size).toBe(3);
    });

    it("should evict items in FIFO order", () => {
      const buf = new CircularBuffer<number>(3);
      buf.add(1);
      buf.add(2);
      buf.add(3);

      buf.add(4); // evicts 1
      expect(buf.has(1)).toBe(false);
      expect(buf.has(2)).toBe(true);

      buf.add(5); // evicts 2
      expect(buf.has(2)).toBe(false);
      expect(buf.has(3)).toBe(true);

      buf.add(6); // evicts 3
      expect(buf.has(3)).toBe(false);
      expect(buf.has(4)).toBe(true);
      expect(buf.has(5)).toBe(true);
      expect(buf.has(6)).toBe(true);
    });

    it("should never exceed capacity in size", () => {
      const capacity = 10;
      const buf = new CircularBuffer<number>(capacity);

      for (let i = 0; i < 100; i++) {
        buf.add(i);
        expect(buf.size).toBeLessThanOrEqual(capacity);
      }

      expect(buf.size).toBe(capacity);
    });
  });

  // ─── Duplicate handling ────────────────────────────────────────

  describe("duplicate handling", () => {
    it("should not increase size when adding a duplicate", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");
      buf.add("b");
      buf.add("a"); // duplicate

      expect(buf.size).toBe(2);
    });

    it("should keep the item accessible after duplicate add", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");
      buf.add("b");
      buf.add("a"); // duplicate

      expect(buf.has("a")).toBe(true);
      expect(buf.has("b")).toBe(true);
    });

    it("should not advance the write index for duplicates", () => {
      const buf = new CircularBuffer<string>(3);
      buf.add("a");
      buf.add("b");
      buf.add("a"); // duplicate — should NOT advance index
      buf.add("c"); // fills slot 2, buffer is now full

      // If duplicate advanced the index, "a" would be evicted here.
      // Since it didn't, all three should still be present.
      expect(buf.has("a")).toBe(true);
      expect(buf.has("b")).toBe(true);
      expect(buf.has("c")).toBe(true);
      expect(buf.size).toBe(3);
    });
  });

  // ─── Clear ─────────────────────────────────────────────────────

  describe("clear", () => {
    it("should remove all items", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");
      buf.add("b");
      buf.add("c");

      buf.clear();

      expect(buf.size).toBe(0);
      expect(buf.has("a")).toBe(false);
      expect(buf.has("b")).toBe(false);
      expect(buf.has("c")).toBe(false);
    });

    it("should allow adding items after clear", () => {
      const buf = new CircularBuffer<string>(3);
      buf.add("a");
      buf.add("b");
      buf.add("c");

      buf.clear();

      buf.add("x");
      buf.add("y");

      expect(buf.size).toBe(2);
      expect(buf.has("x")).toBe(true);
      expect(buf.has("y")).toBe(true);
      expect(buf.has("a")).toBe(false);
    });
  });

  // ─── Wraparound ────────────────────────────────────────────────

  describe("wraparound", () => {
    it("should correctly wrap around and keep only the newest items", () => {
      const buf = new CircularBuffer<number>(4);

      // Fill the buffer: [0, 1, 2, 3]
      for (let i = 0; i < 4; i++) buf.add(i);

      // Add 4 more, fully wrapping: [4, 5, 6, 7]
      for (let i = 4; i < 8; i++) buf.add(i);

      // Only the last 4 should remain
      for (let i = 0; i < 4; i++) expect(buf.has(i)).toBe(false);
      for (let i = 4; i < 8; i++) expect(buf.has(i)).toBe(true);
      expect(buf.size).toBe(4);
    });

    it("should handle multiple full rotations", () => {
      const buf = new CircularBuffer<number>(3);

      // 3 full rotations (9 items through a capacity-3 buffer)
      for (let i = 0; i < 9; i++) buf.add(i);

      // Only last 3 should remain: 6, 7, 8
      expect(buf.has(6)).toBe(true);
      expect(buf.has(7)).toBe(true);
      expect(buf.has(8)).toBe(true);
      expect(buf.size).toBe(3);

      // Earlier items should be gone
      for (let i = 0; i < 6; i++) expect(buf.has(i)).toBe(false);
    });
  });

  // ─── Size tracking ─────────────────────────────────────────────

  describe("size tracking", () => {
    it("should report 0 for empty buffer", () => {
      const buf = new CircularBuffer<string>(5);
      expect(buf.size).toBe(0);
    });

    it("should track size as items are added", () => {
      const buf = new CircularBuffer<string>(5);

      buf.add("a");
      expect(buf.size).toBe(1);

      buf.add("b");
      expect(buf.size).toBe(2);

      buf.add("c");
      expect(buf.size).toBe(3);
    });

    it("should keep size at capacity when full and items are added", () => {
      const buf = new CircularBuffer<string>(3);
      buf.add("a");
      buf.add("b");
      buf.add("c");
      expect(buf.size).toBe(3);

      buf.add("d");
      expect(buf.size).toBe(3);

      buf.add("e");
      expect(buf.size).toBe(3);
    });

    it("should report correct size after clear", () => {
      const buf = new CircularBuffer<string>(5);
      buf.add("a");
      buf.add("b");

      buf.clear();
      expect(buf.size).toBe(0);

      buf.add("x");
      expect(buf.size).toBe(1);
    });
  });

  // ─── Capacity property ─────────────────────────────────────────

  describe("capacity property", () => {
    it("should expose the configured capacity", () => {
      const buf = new CircularBuffer<string>(42);
      expect(buf.capacity).toBe(42);
    });

    it("should retain capacity after clear", () => {
      const buf = new CircularBuffer<string>(10);
      buf.clear();
      expect(buf.capacity).toBe(10);
    });
  });
});

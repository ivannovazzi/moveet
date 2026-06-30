import { describe, it, expect, afterEach } from "vitest";
import {
  mulberry32,
  defaultRng,
  rng,
  getAmbientRng,
  setAmbientRng,
  withAmbientRng,
  toRng,
} from "../utils/rng";

describe("rng", () => {
  afterEach(() => {
    // Ensure no test leaks a seeded ambient Rng into the next.
    setAmbientRng(defaultRng)();
  });

  it("mulberry32 is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("mulberry32 differs across seeds and stays in [0, 1)", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      const v = a.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(a.next()).not.toBe(b.next());
  });

  it("production default: rng() delegates to Math.random when nothing installed", () => {
    // The default ambient Rng is Math.random-backed.
    expect(getAmbientRng()).toBe(defaultRng);
    const v = rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("setAmbientRng installs a seeded stream and restores the previous", () => {
    const before = getAmbientRng();
    const restore = setAmbientRng(7);
    const seeded = mulberry32(7);
    expect(rng()).toBe(seeded.next());
    restore();
    expect(getAmbientRng()).toBe(before);
  });

  it("withAmbientRng scopes a seeded stream for a sync fn and restores after", () => {
    const out = withAmbientRng(99, () => [rng(), rng()]);
    const ref = mulberry32(99);
    expect(out).toEqual([ref.next(), ref.next()]);
    expect(getAmbientRng()).toBe(defaultRng);
  });

  it("withAmbientRng restores after an async fn resolves", async () => {
    const p = withAmbientRng(5, async () => {
      const v = rng();
      await Promise.resolve();
      return v;
    });
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(getAmbientRng()).toBe(defaultRng);
  });

  it("withAmbientRng restores when the sync fn throws", () => {
    expect(() =>
      withAmbientRng(1, () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(getAmbientRng()).toBe(defaultRng);
  });

  it("toRng coerces a number to a seeded Rng and passes an Rng through", () => {
    const direct = mulberry32(3);
    expect(toRng(3).next()).toBe(direct.next());
    expect(toRng(direct)).toBe(direct);
  });
});

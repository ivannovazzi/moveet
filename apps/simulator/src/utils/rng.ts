/**
 * Seeded RNG abstraction.
 *
 * The simulator's nondeterministic spots (vehicle placement, route/destination
 * choice, dwell + speed jitter) historically called the global `Math.random`
 * directly, which makes seeded reproduction (headless generation, tests) a
 * fragile global-monkeypatch affair. This module introduces a tiny injectable
 * `Rng` so those spots can draw from a seeded stream when one is installed,
 * while the PRODUCTION DEFAULT stays exactly `Math.random` (no behavior change
 * when nothing is installed).
 *
 * Design:
 * - `Rng` is just `{ next(): number }` returning a float in [0, 1).
 * - `defaultRng` delegates to `Math.random` — the unchanged production path.
 * - A single process-level "ambient" Rng is read through `rng()`. Call sites
 *   that used `Math.random()` call `rng()` instead. With no ambient Rng set,
 *   `rng()` === `Math.random()`.
 * - `withAmbientRng(seedOrRng, fn)` installs a seeded stream for the duration
 *   of a (sync or async) call and always restores the previous one. This is the
 *   seam the HeadlessRunner uses instead of reassigning `Math.random`.
 */

/** A source of uniformly-distributed floats in [0, 1). */
export interface Rng {
  next(): number;
}

/** Production default: the global `Math.random`. */
export const defaultRng: Rng = {
  next: () => Math.random(),
};

/**
 * mulberry32 — a tiny, fast, well-distributed seeded PRNG. Deterministic for a
 * given 32-bit seed. Not cryptographic; intended only for reproducible sims.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Coerces a number seed or an `Rng` into an `Rng`. */
export function toRng(seedOrRng: number | Rng): Rng {
  return typeof seedOrRng === "number" ? mulberry32(seedOrRng) : seedOrRng;
}

// The single process-level ambient Rng. Defaults to Math.random so existing
// behavior is byte-for-byte unchanged until something installs a seeded stream.
let ambient: Rng = defaultRng;

/** Returns the currently-installed ambient Rng. */
export function getAmbientRng(): Rng {
  return ambient;
}

/** Installs an ambient Rng (or seeds one). Returns a restore function. */
export function setAmbientRng(seedOrRng: number | Rng): () => void {
  const prev = ambient;
  ambient = toRng(seedOrRng);
  return () => {
    ambient = prev;
  };
}

/**
 * Draw the next float from the ambient Rng. Drop-in replacement for
 * `Math.random()` at the seams that want to be seedable. With no ambient Rng
 * installed this IS `Math.random()`.
 */
export function rng(): number {
  return ambient.next();
}

/**
 * Runs `fn` with a seeded ambient Rng installed, restoring the previous ambient
 * Rng afterwards (even if `fn` throws / rejects). Handles both sync and async
 * `fn`. This replaces the old global `Math.random` reassignment.
 */
export function withAmbientRng<T>(seedOrRng: number | Rng, fn: () => T): T {
  const restore = setAmbientRng(seedOrRng);
  let result: T;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result instanceof Promise) {
    return result.finally(restore) as unknown as T;
  }
  restore();
  return result;
}

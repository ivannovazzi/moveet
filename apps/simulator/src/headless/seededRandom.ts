import { mulberry32, setAmbientRng } from "../utils/rng";

/**
 * Installs a seeded mulberry32 stream for the duration of a headless run and
 * returns a restore function. A SINGLE stream backs both:
 *  - the injectable ambient Rng (`src/utils/rng.ts`), which the threaded
 *    placement/routing seams draw from, and
 *  - the global `Math.random` (legacy fallback for any spot not yet threaded),
 * so a given `seed` reproduces the same run.
 *
 * Shared by `HeadlessRunner` (recording generation) and `ScenarioRunner` (the
 * assertion harness) — both only mean anything if they are reproducible.
 */
export function installSeededRandom(seed: number): () => void {
  const stream = mulberry32(seed);
  const restoreAmbient = setAmbientRng(stream);
  const original = Math.random;
  Math.random = () => stream.next();
  return () => {
    Math.random = original;
    restoreAmbient();
  };
}

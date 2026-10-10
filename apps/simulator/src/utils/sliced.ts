/**
 * Cooperative slicing for long main-thread loops.
 *
 * A long build step is written once as a generator that `yield`s every few
 * thousand iterations. {@link runToEnd} drains it synchronously (the classic
 * blocking behaviour, used at startup and by tests), {@link runSliced} drains
 * it in slices of about `budgetMs`, handing the event loop back between slices
 * so HTTP and WebSocket traffic keeps flowing while a map loads.
 *
 * Both drive the very same steps in the same order, so the result is identical.
 */

/** Iterations between two yield points in a sliced loop (a power of two minus one, for `&`). */
export const SLICE_MASK = 4095;

/** Default time slice: well under a frame, and far under a request timeout. */
export const DEFAULT_SLICE_BUDGET_MS = 12;

const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Runs `steps` to completion without yielding; returns the generator's result. */
export function runToEnd<T>(steps: Generator<unknown, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Runs `steps` to completion, giving the event loop a turn whenever a slice
 * has used up `budgetMs`. Resolves with the generator's result.
 */
export async function runSliced<T>(
  steps: Generator<unknown, T>,
  budgetMs: number = DEFAULT_SLICE_BUDGET_MS
): Promise<T> {
  let sliceStart = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - sliceStart >= budgetMs) {
      await nextMacrotask();
      sliceStart = performance.now();
    }
  }
}

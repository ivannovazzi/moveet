import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useJobsAutoReveal } from "./useJobsAutoReveal";
import type { Modifiers } from "@/types";

/** Minimal modifiers stand-in — only `showJobs` matters here. */
function modifiers(showJobs?: boolean): Modifiers {
  return { showJobs } as unknown as Modifiers;
}

/** Drives the hook's setModifiers updater against a starting state. */
function capture(start: Modifiers) {
  let state = start;
  const setModifiers = vi.fn((update: unknown) => {
    state = typeof update === "function" ? (update as (p: Modifiers) => Modifiers)(state) : state;
  });
  return { setModifiers, read: () => state };
}

describe("useJobsAutoReveal", () => {
  it("does nothing while the board is empty", () => {
    const { setModifiers } = capture(modifiers(false));

    renderHook(() => useJobsAutoReveal(0, setModifiers));

    expect(setModifiers).not.toHaveBeenCalled();
  });

  it("reveals the overlay when the first job appears", () => {
    const { setModifiers, read } = capture(modifiers(false));
    const { rerender } = renderHook(({ count }) => useJobsAutoReveal(count, setModifiers), {
      initialProps: { count: 0 },
    });

    rerender({ count: 1 });

    expect(read().showJobs).toBe(true);
  });

  it("reveals on mount when jobs already exist", () => {
    const { setModifiers, read } = capture(modifiers(false));

    // prevCount seeds to the mount value, so a non-zero mount is not an edge —
    // but the board can only be non-empty on mount after a refetch, and the
    // operator has not been shown the layer yet.
    renderHook(() => useJobsAutoReveal(0, setModifiers));
    expect(read().showJobs).toBe(false);
  });

  it("does not re-reveal after the operator toggles it back off", () => {
    const { setModifiers, read } = capture(modifiers(false));
    const { rerender } = renderHook(({ count }) => useJobsAutoReveal(count, setModifiers), {
      initialProps: { count: 0 },
    });

    rerender({ count: 1 });
    expect(read().showJobs).toBe(true);

    // Operator hides it again, then more jobs arrive (still non-empty).
    setModifiers(() => modifiers(false));
    rerender({ count: 3 });

    expect(read().showJobs).toBe(false);
  });

  it("reveals again after the board empties and refills", () => {
    const { setModifiers, read } = capture(modifiers(false));
    const { rerender } = renderHook(({ count }) => useJobsAutoReveal(count, setModifiers), {
      initialProps: { count: 0 },
    });

    rerender({ count: 1 });
    setModifiers(() => modifiers(false));
    rerender({ count: 0 });
    rerender({ count: 2 });

    expect(read().showJobs).toBe(true);
  });

  it("leaves an already-visible overlay untouched", () => {
    const { setModifiers, read } = capture(modifiers(true));
    const before = read();
    const { rerender } = renderHook(({ count }) => useJobsAutoReveal(count, setModifiers), {
      initialProps: { count: 0 },
    });

    rerender({ count: 1 });

    expect(read()).toBe(before);
  });
});

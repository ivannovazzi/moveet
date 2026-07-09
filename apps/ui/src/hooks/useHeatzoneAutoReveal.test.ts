import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHeatzoneAutoReveal } from "./useHeatzoneAutoReveal";
import type { Modifiers } from "@/types";
import type { HeatzoneEditorMode } from "./useHeatzoneEditor";

function setup(initial: { mode: HeatzoneEditorMode; seedNonce: number; showHeatzones: boolean }) {
  const setModifiers = vi.fn((updater: (prev: Modifiers) => Modifiers) => {
    // Apply so we can observe whether it flips the flag on.
    updater({ showHeatzones: initial.showHeatzones } as Modifiers);
  });
  const { rerender } = renderHook(
    ({ mode, seedNonce }: { mode: HeatzoneEditorMode; seedNonce: number }) =>
      useHeatzoneAutoReveal(mode, seedNonce, setModifiers),
    { initialProps: { mode: initial.mode, seedNonce: initial.seedNonce } }
  );
  return { setModifiers, rerender };
}

describe("useHeatzoneAutoReveal", () => {
  it("forces visibility on when entering a non-idle mode from idle", () => {
    const { setModifiers, rerender } = setup({
      mode: "idle",
      seedNonce: 0,
      showHeatzones: false,
    });
    expect(setModifiers).not.toHaveBeenCalled();
    rerender({ mode: "selected", seedNonce: 0 });
    expect(setModifiers).toHaveBeenCalledTimes(1);
  });

  it("does not revert a user-driven hide while still non-idle (edge-triggered, not continuous)", () => {
    const { setModifiers, rerender } = setup({
      mode: "idle",
      seedNonce: 0,
      showHeatzones: false,
    });
    // Enter select -> reveal fires once.
    rerender({ mode: "selected", seedNonce: 0 });
    expect(setModifiers).toHaveBeenCalledTimes(1);
    setModifiers.mockClear();
    // User toggles the layer off; the hook re-renders but stays in select mode.
    // The layer must NOT be forced back on.
    rerender({ mode: "selected", seedNonce: 0 });
    expect(setModifiers).not.toHaveBeenCalled();
  });

  it("forces visibility on for a fresh seed (seedNonce increment)", () => {
    const { setModifiers, rerender } = setup({
      mode: "idle",
      seedNonce: 0,
      showHeatzones: false,
    });
    rerender({ mode: "idle", seedNonce: 1 });
    expect(setModifiers).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a draw -> select transition (only idle -> non-idle)", () => {
    const { setModifiers, rerender } = setup({
      mode: "draw",
      seedNonce: 0,
      showHeatzones: false,
    });
    setModifiers.mockClear();
    rerender({ mode: "selected", seedNonce: 0 });
    expect(setModifiers).not.toHaveBeenCalled();
  });
});

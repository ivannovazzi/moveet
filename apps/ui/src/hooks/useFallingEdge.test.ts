import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFallingEdge } from "./useFallingEdge";

function render(active: boolean, onFall: () => void) {
  return renderHook(
    ({ active, onFall }: { active: boolean; onFall: () => void }) => useFallingEdge(active, onFall),
    { initialProps: { active, onFall } }
  );
}

describe("useFallingEdge", () => {
  it("does not fire on the initial mount (even when active)", () => {
    const onFall = vi.fn();
    render(true, onFall);
    expect(onFall).not.toHaveBeenCalled();
  });

  it("fires once on the active → inactive transition", () => {
    const onFall = vi.fn();
    const { rerender } = render(true, onFall);

    rerender({ active: false, onFall });
    expect(onFall).toHaveBeenCalledTimes(1);
  });

  it("does not fire on the rising edge (inactive → active)", () => {
    const onFall = vi.fn();
    const { rerender } = render(false, onFall);

    rerender({ active: true, onFall });
    expect(onFall).not.toHaveBeenCalled();
  });

  it("fires again on each subsequent falling edge", () => {
    const onFall = vi.fn();
    const { rerender } = render(true, onFall);

    rerender({ active: false, onFall });
    rerender({ active: true, onFall });
    rerender({ active: false, onFall });

    expect(onFall).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without re-firing when only the callback changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(true, first);

    // Swapping the callback while still active must not fire either.
    rerender({ active: true, onFall: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    // The falling edge fires only the latest callback.
    rerender({ active: false, onFall: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

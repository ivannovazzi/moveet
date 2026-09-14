import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import Region from "./Region";
import { presenceClass, PRESENCE_EXIT_MS } from "./usePresence";

/**
 * Surfaces used to be unmounted on the frame they were closed, so every open
 * was considered and every close was a pop. These pin the three things that
 * fixes: the surface survives its own exit, the exit is opacity alone, and the
 * entrance starts from an offset rather than in place.
 */
beforeEach(() => {
  // The settle step is a `requestAnimationFrame`, so fake that alongside the
  // exit timer rather than stubbing one and not the other.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });
});

afterEach(() => vi.useRealTimers());

const region = () => screen.getByText("surface");
const settle = () => act(() => void vi.advanceTimersByTime(20));

describe("a region that comes and goes", () => {
  it("starts offset and transparent, then settles", () => {
    render(<Region open>surface</Region>);
    // The starting frame of the transition. Without it there is nothing for the
    // entrance to animate *from* — the surface would simply appear.
    expect(region()).toHaveAttribute("data-state", "entering");
    expect(region().className).toContain("opacity-0");

    settle();
    expect(region()).toHaveAttribute("data-state", "open");
    expect(region().className).toContain("opacity-100");
  });

  it("stays on screen while it fades, then leaves", () => {
    const { rerender } = render(<Region open>surface</Region>);
    settle();

    rerender(<Region open={false}>surface</Region>);
    expect(region()).toHaveAttribute("data-state", "closing");
    // Still mounted, and no longer clickable — it is on its way out, not a
    // target.
    expect(region().className).toContain("pointer-events-none");

    act(() => void vi.advanceTimersByTime(PRESENCE_EXIT_MS));
    expect(screen.queryByText("surface")).not.toBeInTheDocument();
  });

  it("leaves without travelling, having arrived with it", () => {
    // Arriving from an edge reads as being produced by it. Sliding back out the
    // same way would read as being put away, and most of these are dismissed.
    expect(presenceClass("entering", "right")).toContain("translate-x-2");
    expect(presenceClass("closing", "right")).not.toContain("translate-x");
    expect(presenceClass("closing", "right")).toContain("transition-opacity");
  });

  it("transitions the property Tailwind actually sets", () => {
    // `translate-*` sets the individual `translate` property in Tailwind v4, so
    // a transition list naming only `transform` fades the surface in while
    // snapping it into place.
    expect(presenceClass("open")).toContain("transition-[opacity,translate]");
  });

  it("does not animate a surface that is always there", () => {
    render(<Region>surface</Region>);
    // No `open` prop: the dock, the left column. Nothing to hold on screen, and
    // no state to read.
    expect(region()).not.toHaveAttribute("data-state");
    expect(region().className).not.toContain("opacity-0");
  });

  it("renders nothing for a surface that was never up", () => {
    render(<Region open={false}>surface</Region>);
    // It has nothing to fade *from*, so it goes straight to closed rather than
    // spending 150ms invisibly transitioning.
    expect(screen.queryByText("surface")).not.toBeInTheDocument();
  });
});

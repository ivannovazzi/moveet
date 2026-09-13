import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { render } from "@testing-library/react";
import AnchoredPanel from "./AnchoredPanel";
import { getInsets, resetInsets } from "@/components/Map/mapInsets";

/**
 * jsdom has no layout, so every rect is zero. These stub the one measurement
 * the inset reporting depends on — the panel's own box — and check what it
 * concludes from it.
 */
function stubRects(rect: Partial<DOMRect>) {
  const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
  return spy;
}

function Harness({ open, insetKey }: { open: boolean; insetKey?: string }) {
  const originRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div ref={originRef}>
      <button type="button" ref={anchorRef}>
        key
      </button>
      <AnchoredPanel
        open={open}
        id="panel"
        aria-label="Panel"
        anchorRef={anchorRef}
        originRef={originRef}
        width="w-[460px]"
        positionKey="one"
        insetKey={insetKey}
        onClose={vi.fn()}
      >
        body
      </AnchoredPanel>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetInsets();
});

describe("what an open panel tells the camera it is covering", () => {
  it("claims the band from its left edge to the right of the screen, and nothing else", () => {
    // A 460px panel sitting 8px in from the right edge of a 1024x768 window,
    // 300px tall, standing on the dock shelf.
    stubRects({ left: 556, right: 1016, top: 380, bottom: 680, width: 460, height: 300 });
    render(<Harness open insetKey="dock-section-panel" />);

    expect(getInsets().right).toBe(1024 - 556);
    // Only the right band: the strip of map left of the panel is where the
    // camera should aim, so the panel never claims a bottom band.
    expect(getInsets().bottom).toBe(0);
  });

  it("claims nothing while it is closed, and gives the band back when it closes", () => {
    stubRects({ left: 556, right: 1016, top: 380, bottom: 680, width: 460, height: 300 });
    const { rerender } = render(<Harness open={false} insetKey="dock-section-panel" />);
    expect(getInsets().right).toBe(0);

    rerender(<Harness open insetKey="dock-section-panel" />);
    expect(getInsets().right).toBeGreaterThan(0);

    rerender(<Harness open={false} insetKey="dock-section-panel" />);
    expect(getInsets().right).toBe(0);
  });

  it("stays out of the register unless it was given a key", () => {
    stubRects({ left: 556, right: 1016, top: 380, bottom: 680, width: 460, height: 300 });
    render(<Harness open />);
    expect(getInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import AnchoredPanel from "./AnchoredPanel";

/**
 * What is left of the anchored panel: the Tempo popover.
 *
 * It used to report the band of map it covered to `mapInsets`, so a camera move
 * could aim around it — which mattered when the section panel was one of these
 * and covered 520px of the right edge. The section panels are the console now
 * (see `shell/Console`), which takes layout space instead of covering the map,
 * so there is nothing left for a panel to report.
 */
function Harness({ open, onClose = vi.fn() }: { open: boolean; onClose?: () => void }) {
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
        onClose={onClose}
      >
        body
      </AnchoredPanel>
    </div>
  );
}

describe("the dock's anchored popover", () => {
  it("stays mounted when closed, so switching views morphs rather than remounts", () => {
    render(<Harness open={false} />);
    const panel = screen.getByLabelText("Panel", { selector: "[id='panel']" });
    // Mounted but inert: its controls are out of the tab order and it takes no
    // clicks, without the remount that would restart every entrance inside it.
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
  });

  it("is live and takes the pointer when open", () => {
    render(<Harness open />);
    const panel = screen.getByRole("region", { name: "Panel" });
    expect(panel).not.toHaveAttribute("inert");
    expect(panel.parentElement?.className).toContain("pointer-events-auto");
  });

  it("closes on a click outside it — it is a popover, not a docked surface", () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">elsewhere</button>
        <Harness open onClose={onClose} />
      </div>
    );

    screen
      .getByRole("button", { name: "elsewhere" })
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });
});

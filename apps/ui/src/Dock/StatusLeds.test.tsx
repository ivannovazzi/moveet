import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pause, Play, Wifi, WifiOff } from "lucide-react";
import StatusLeds, { type StatusLed } from "./StatusLeds";

/**
 * fleetsim-all-hly6: the lamps identify themselves with an icon and a real
 * tooltip, not with four characters of uppercase shorthand.
 */

const LEDS: StatusLed[] = [
  { key: "ws", icon: Wifi, tone: "ok", title: "Live socket connected" },
  { key: "sim", icon: Pause, tone: "idle", title: "Simulation paused" },
];

/** The lamp `span`s, which carry the tone class and the tab stop. */
function lamps(): HTMLElement[] {
  return Array.from(
    screen.getByRole("status", { name: "Run health" }).querySelectorAll('[tabindex="0"]')
  );
}

describe("StatusLeds", () => {
  it("renders one lamp per led, with no abbreviation text", () => {
    render(<StatusLeds leds={LEDS} />);
    expect(lamps()).toHaveLength(2);
    // The `WS`/`SIM`/`FEED`/`WX` shorthand is gone — nothing in the row reads
    // as a cryptic label.
    expect(screen.queryByText("WS")).not.toBeInTheDocument();
    expect(screen.queryByText("SIM")).not.toBeInTheDocument();
  });

  it("draws the icon the caller chose for the led's own state", () => {
    const { rerender } = render(<StatusLeds leds={LEDS} />);
    expect(document.querySelector(".lucide-wifi")).toBeInTheDocument();
    expect(document.querySelector(".lucide-wifi-off")).not.toBeInTheDocument();

    rerender(<StatusLeds leds={[{ ...LEDS[0], icon: WifiOff, tone: "idle" }, LEDS[1]]} />);
    expect(document.querySelector(".lucide-wifi-off")).toBeInTheDocument();
  });

  it("tints each lamp by its semantic tone", () => {
    render(<StatusLeds leds={LEDS} />);
    const [ok, idle] = lamps();
    expect(ok.className).toContain("text-status-ok");
    expect(idle.className).toContain("text-muted-foreground");
  });

  it("keeps the state in text inside the live region, so a change is announced", () => {
    // The icon is aria-hidden and colour is not a signal; the readable state
    // has to be text content of the role=status region.
    render(<StatusLeds leds={LEDS} />);
    const region = screen.getByRole("status", { name: "Run health" });
    expect(region).toHaveTextContent("Live socket connected");
    expect(region).toHaveTextContent("Simulation paused");
    expect(document.querySelector(".lucide-wifi")).toHaveAttribute("aria-hidden");
  });

  it("spells the state out in a tooltip on hover", async () => {
    const user = userEvent.setup();
    render(<StatusLeds leds={LEDS} />);

    await user.hover(lamps()[0]);

    // Two copies once open: the trigger's own sr-only name, and the tooltip.
    await waitFor(() =>
      expect(screen.getAllByText("Live socket connected").length).toBeGreaterThan(1)
    );
  });

  it("opens the tooltip from the keyboard too", async () => {
    const user = userEvent.setup();
    render(<StatusLeds leds={LEDS} />);

    await user.tab();

    expect(lamps()[0]).toHaveFocus();
    await waitFor(() =>
      expect(screen.getAllByText("Live socket connected").length).toBeGreaterThan(1)
    );
  });

  it("stays inert until the app has painted in", () => {
    render(<StatusLeds leds={LEDS} />);
    const region = screen.getByRole("status", { name: "Run health" });
    // Hover and focus are gated on the shell's `data-ready` reveal, the same
    // gate the fade uses — without it the tooltips would be reachable over a
    // surface that is still invisible.
    expect(region.className).toContain("pointer-events-none");
    expect(region.className).toContain("[[data-ready]_&]:pointer-events-auto");
  });

  it("passes through a caller's class names", () => {
    render(<StatusLeds leds={LEDS} className="test-hook" />);
    expect(screen.getByRole("status", { name: "Run health" }).className).toContain("test-hook");
  });
});

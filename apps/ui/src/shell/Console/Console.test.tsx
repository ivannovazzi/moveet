import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import Console from "./Console";
import {
  clampConsoleWidth,
  CONSOLE_DEFAULT_WIDTH,
  CONSOLE_MIN_WIDTH,
  maxConsoleWidth,
} from "./useConsoleSize";

function renderConsole(props: Partial<React.ComponentProps<typeof Console>> = {}) {
  return render(
    <Console open title="Monitor" onClose={vi.fn()} {...props}>
      <div>panel body</div>
    </Console>
  );
}

const handle = () => screen.getByRole("button", { name: "Resize console" });
const surface = () => screen.getByRole("region", { name: "Monitor" });

/** jsdom fires no pointer events of its own; drive the listeners directly. */
function drag(toClientX: number) {
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: toClientX }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup"));
  });
}

describe("the console's width", () => {
  it("clamps to a usable band rather than to the window", () => {
    // Below the minimum the vehicle list's rows start wrapping; above the
    // maximum the map stops being the thing you are working on.
    expect(clampConsoleWidth(100, 1600)).toBe(CONSOLE_MIN_WIDTH);
    expect(clampConsoleWidth(1500, 1600)).toBe(maxConsoleWidth(1600));
    expect(clampConsoleWidth(500, 1600)).toBe(500);
  });

  it("keeps the minimum even on a window too narrow to honour the maximum", () => {
    // 55% of 400px is 220px, which is narrower than anything in the console can
    // render. The minimum wins and the console overflows instead of collapsing.
    expect(maxConsoleWidth(400)).toBe(CONSOLE_MIN_WIDTH);
  });

  it("opens at the default width, and survives a reload at the dragged one", () => {
    const { unmount } = renderConsole();
    expect(surface().style.width).toBe(`${CONSOLE_DEFAULT_WIDTH}px`);

    // The console is flush with the window's right edge, so its width is the
    // distance from the pointer to that edge.
    drag(window.innerWidth - 500);
    expect(surface().style.width).toBe("500px");

    unmount();
    renderConsole();
    expect(surface().style.width).toBe("500px");
  });

  it("goes back to the default on a double-click of the handle", () => {
    renderConsole();
    drag(window.innerWidth - 520);
    expect(surface().style.width).toBe("520px");

    fireEvent.doubleClick(handle());
    expect(surface().style.width).toBe(`${CONSOLE_DEFAULT_WIDTH}px`);
  });

  it("gives the width back when the window shrinks past its share", () => {
    const originalWidth = window.innerWidth;
    renderConsole();
    drag(window.innerWidth - 500);
    expect(surface().style.width).toBe("500px");

    act(() => {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
    });

    // 500px of an 800px window would leave the map a sliver.
    expect(Number.parseInt(surface().style.width, 10)).toBe(maxConsoleWidth(800));
    window.innerWidth = originalWidth;
  });
});

describe("the console as a surface", () => {
  it("takes layout space rather than floating over the map", () => {
    renderConsole();
    // The whole reason it cannot overlap anything: it is a flex child beside
    // the map, not an absolutely-positioned box on top of it.
    expect(surface().className).not.toContain("absolute");
    expect(surface().className).not.toContain("fixed");
    expect(surface().className).toContain("shrink-0");
  });

  it("renders nothing at all when closed", () => {
    renderConsole({ open: false });
    // Not a zero-width container: that would still be a flex child carrying a
    // border, and a 1px seam down the right of the map.
    expect(screen.queryByRole("region", { name: "Monitor" })).not.toBeInTheDocument();
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
  });

  it("names itself and its close control after what it is showing", () => {
    renderConsole({ title: "Session" });
    expect(screen.getByRole("region", { name: "Session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Session" })).toBeInTheDocument();
  });

  it("closes from its own header", async () => {
    const onClose = vi.fn();
    renderConsole({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close Monitor" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

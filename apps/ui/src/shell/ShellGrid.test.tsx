import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ShellGrid from "./ShellGrid";
import Region from "./Region";
import { getInsets, resetInsets } from "@/components/Map/mapInsets";

/**
 * jsdom has no layout engine, so none of this can measure pixels. What it can
 * assert is the rule that produces the pixels: which track each surface is in,
 * and which track template that row uses. Those templates are the whole
 * guarantee — a surface in the left track cannot overlap one in the centre
 * track, whatever either of them contains.
 */
const row = (name: string) => document.querySelector(`[data-shell-row="${name}"]`) as HTMLElement;

describe("ShellGrid", () => {
  it("is three rows: the search band, the open map, the dock", () => {
    render(
      <ShellGrid
        topCenter={<Region>search</Region>}
        left={<Region>rail</Region>}
        bottom={<div>dock</div>}
      />
    );

    const grid = document.querySelector("[data-shell-grid]") as HTMLElement;
    // The middle row is the only flexible one, so the two bands either side of
    // it are sized by their contents and the map gets exactly what is left.
    expect(grid.className).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    // One 12px outer margin and one 12px gap between bands, in one place
    // instead of repeated as `left-3` / `top-3` / `bottom-3` on each surface.
    expect(grid.className).toContain("p-3");
    expect(grid.className).toContain("gap-3");
    // Click-through as a whole: it covers the entire map.
    expect(grid.className).toContain("pointer-events-none");
  });

  it("lets the search band's centre shrink before its corners give way", () => {
    render(<ShellGrid topCenter={<Region>search</Region>} />);
    // `minmax(0,auto)` on the centre track: it grows to the search bar's width
    // only while there is room. `minmax(auto,1fr)` on the sides: equal, so the
    // centre is on the viewport's centre line, but never below their contents.
    // So on a narrow window the search bar narrows and the health lamps keep
    // their corner, instead of the two landing on top of each other.
    expect(row("top").className).toContain(
      "grid-cols-[minmax(auto,1fr)_minmax(0,auto)_minmax(auto,1fr)]"
    );
  });

  it("gives the open map's fixed instruments priority over its transient centre", () => {
    render(<ShellGrid left={<Region>rail</Region>} right={<Region>inspector</Region>} />);
    // The opposite priority to the row above: the legend column and the
    // inspector hold their width and the centre takes what is left, because the
    // centre here only ever holds a transient hint.
    expect(row("middle").className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
  });

  it("keeps every track occupied so a missing surface cannot shift the others", () => {
    render(<ShellGrid topRight={<Region>lamps</Region>} />);
    // Two empty placeholders and the lamps: without them the lamps would fall
    // into the first track and land on the left edge.
    expect(row("top").children).toHaveLength(3);
    expect(row("middle").children).toHaveLength(3);
  });
});

describe("Region", () => {
  it("takes the pointer for its own box and nothing more", () => {
    render(<Region>surface</Region>);
    const region = screen.getByText("surface");
    // Sized to its contents (the grid track is not its width), so it swallows
    // exactly the surface and leaves the map either side of it draggable.
    expect(region.className).toContain("pointer-events-auto");
    expect(region.className).toContain("justify-self-start");
    expect(region.className).toContain("self-start");
  });

  it("stays click-through for a surface that manages its own pointer events", () => {
    render(<Region interactive={false}>legends</Region>);
    // The legend column covers a tall strip of map it must not steal drags
    // from, and re-enables the pointer only on the part that scrolls.
    expect(screen.getByText("legends").className).toContain("pointer-events-none");
  });

  it("can stretch to its track when the surface caps itself against it", () => {
    render(
      <Region justify="end" align="stretch">
        inspector
      </Region>
    );
    const region = screen.getByText("inspector");
    expect(region.className).toContain("justify-self-end");
    expect(region.className).toContain("self-stretch");
  });
});

/**
 * What the camera is told the chrome is covering.
 *
 * jsdom reports every rect as zero, so these stub the three boxes the
 * measurement reads — the grid and its two bands — and check what it concludes.
 * The point of measuring at all is that a taller search band or a dock that
 * grows a row moves the number on its own; the constants this replaced
 * (`SEARCH_BAND = 74`, `DOCK_BAND = 78`) had to be edited by hand to follow.
 */
describe("the bands the shell reports to the camera", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetInsets();
  });

  /** A 1000px-tall map pane: search band 12..62, dock row 690..756. */
  function stubBands({ topBottom = 62, bottomTop = 690 } = {}) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
    ) {
      const row = (this as HTMLElement).dataset?.shellRow;
      const box =
        row === "top"
          ? { top: 12, bottom: topBottom }
          : row === "bottom"
            ? { top: bottomTop, bottom: 768 }
            : { top: 0, bottom: 768 };
      return { ...box, left: 0, right: 1024, width: 1024, height: box.bottom - box.top } as DOMRect;
    });
  }

  it("claims each band from the viewport edge to the far side of its row", () => {
    stubBands();
    render(<ShellGrid topCenter={<Region>search</Region>} bottom={<div>dock</div>} />);

    // Top: the row ends 62px down, plus the 12px gap it holds open below it.
    expect(getInsets().top).toBe(74);
    // Bottom: the row starts 690px down a 768px pane, plus the same gap.
    expect(getInsets().bottom).toBe(90);
    // Nothing on the sides: the console takes layout space rather than covering
    // the canvas, and the middle row's instruments are narrow and click-through.
    expect(getInsets().left).toBe(0);
    expect(getInsets().right).toBe(0);
  });

  it("follows a band that changes height instead of holding a constant", () => {
    // A mode banner taller than the search bar — the case the old constant got
    // wrong, silently, until someone noticed the camera aiming low.
    stubBands({ topBottom: 96 });
    render(<ShellGrid topCenter={<Region>banner</Region>} bottom={<div>dock</div>} />);
    expect(getInsets().top).toBe(108);
  });

  it("gives both bands back when the shell unmounts", () => {
    stubBands();
    const { unmount } = render(<ShellGrid bottom={<div>dock</div>} />);
    expect(getInsets().top).toBeGreaterThan(0);
    unmount();
    expect(getInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

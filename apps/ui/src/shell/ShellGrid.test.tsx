import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ShellGrid from "./ShellGrid";
import Region from "./Region";

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

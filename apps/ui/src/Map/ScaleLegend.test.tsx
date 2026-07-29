import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ScaleLegend, { quantizeBreaks } from "./ScaleLegend";

const RAMP = [
  [10, 0, 40, 70],
  [20, 0, 60, 103],
  [30, 0, 80, 136],
  [40, 0, 100, 169],
  [50, 0, 120, 202],
  [60, 0, 140, 235],
] as const;

describe("quantizeBreaks", () => {
  it("returns one more boundary than there are steps", () => {
    expect(quantizeBreaks([0, 6], 6)).toHaveLength(7);
  });

  it("splits the domain into equal-width intervals", () => {
    expect(quantizeBreaks([0, 12], 6)).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it("anchors the first and last boundary to the domain ends", () => {
    const breaks = quantizeBreaks([3, 91], 6);
    expect(breaks[0]).toBe(3);
    expect(breaks[breaks.length - 1]).toBe(91);
  });

  it("handles a degenerate single-value domain", () => {
    expect(quantizeBreaks([7, 7], 6)).toEqual([7, 7, 7, 7, 7, 7, 7]);
  });
});

describe("ScaleLegend", () => {
  it("renders one swatch per ramp step", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={[1, 61]} />);
    expect(screen.getAllByTestId("scale-legend-step")).toHaveLength(RAMP.length);
  });

  it("paints each swatch with the colour it was given, alpha included", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={[1, 61]} />);
    const steps = screen.getAllByTestId("scale-legend-step");
    // Alpha is serialised with implementation-defined precision, so match the
    // channels rather than the exact string.
    const parse = (css: string) => css.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(parse(steps[0].style.backgroundColor).slice(0, 3)).toEqual([10, 0, 40]);
    expect(parse(steps[0].style.backgroundColor)[3]).toBeCloseTo(70 / 255, 3);
    expect(parse(steps[5].style.backgroundColor).slice(0, 3)).toEqual([60, 0, 140]);
    expect(parse(steps[5].style.backgroundColor)[3]).toBeCloseTo(235 / 255, 3);
  });

  it("labels the ends of the domain it was handed", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={[4, 250]} />);
    expect(screen.getByTestId("scale-legend-min")).toHaveTextContent("4");
    expect(screen.getByTestId("scale-legend-max")).toHaveTextContent("250");
  });

  it("exposes every bin boundary in the screen-reader table", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={[0, 60]} />);
    const rows = screen.getByTestId("scale-legend-table").querySelectorAll("li");
    expect(rows).toHaveLength(RAMP.length);
    expect(rows[0].textContent).toBe("Step 1 of 6: 0 to 10");
    expect(rows[5].textContent).toBe("Step 6 of 6: 50 to 60");
  });

  it("shows placeholders, not invented numbers, before a domain is known", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={null} />);
    expect(screen.getByTestId("scale-legend-min")).toHaveTextContent("—");
    expect(screen.getByTestId("scale-legend-max")).toHaveTextContent("—");
    expect(screen.queryByTestId("scale-legend-table")).toBeNull();
    // The ramp itself is still shown — it is what is on screen.
    expect(screen.getAllByTestId("scale-legend-step")).toHaveLength(RAMP.length);
  });

  it("scopes its test ids so several overlays can each own a legend", () => {
    render(
      <>
        <ScaleLegend testId="a-legend" title="A" colorRange={RAMP} domain={[0, 6]} />
        <ScaleLegend testId="b-legend" title="B" colorRange={RAMP.slice(0, 3)} domain={[0, 9]} />
      </>
    );
    expect(screen.getAllByTestId("a-legend-step")).toHaveLength(6);
    expect(screen.getAllByTestId("b-legend-step")).toHaveLength(3);
    expect(screen.getByTestId("b-legend-max")).toHaveTextContent("9");
  });

  it("is labelled as a figure for assistive tech and stays click-through", () => {
    render(<ScaleLegend title="Vehicles per bin" colorRange={RAMP} domain={[1, 61]} />);
    const root = screen.getByTestId("scale-legend");
    expect(root).toHaveAttribute("role", "figure");
    expect(root).toHaveAttribute("aria-label", "Vehicles per bin");
    expect(root.className).toContain("pointer-events-none");
  });

  it("formats values with the caller's formatter", () => {
    render(
      <ScaleLegend
        title="Speed"
        colorRange={RAMP}
        domain={[0, 60]}
        formatValue={(v) => `${v} km/h`}
      />
    );
    expect(screen.getByTestId("scale-legend-max")).toHaveTextContent("60 km/h");
  });
});

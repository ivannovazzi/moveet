import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Sparkline, { buildSparkGeometry } from "./Sparkline";

describe("buildSparkGeometry", () => {
  it("projects an evenly-spaced series onto the viewBox", () => {
    // width 102 → x ∈ [1, 101]; height 22 → y ∈ [2, 20] (2px padding).
    const geom = buildSparkGeometry([0, 50, 100], 102, 22, 0);
    expect(geom).not.toBeNull();
    expect(geom?.line).toBe("M1,20L51,11L101,2");
    expect(geom?.lo).toBe(0);
    expect(geom?.hi).toBe(100);
  });

  it("auto-scales to the series when no floor is given", () => {
    const geom = buildSparkGeometry([20, 30], 102, 22);
    // lo=20 sits on the bottom, hi=30 on the top.
    expect(geom?.line).toBe("M1,20L101,2");
  });

  it("keeps a flat series on the baseline instead of dividing by zero", () => {
    const geom = buildSparkGeometry([7, 7, 7], 102, 22);
    expect(geom?.line).toBe("M1,20L51,20L101,20");
  });

  it("closes an area path under each line run", () => {
    const geom = buildSparkGeometry([0, 100], 102, 22, 0);
    expect(geom?.runs).toHaveLength(1);
    expect(geom?.runs[0].area).toBe("M1,20L101,2L101,22L1,22Z");
  });

  it("breaks the line into separate runs across null gaps", () => {
    const geom = buildSparkGeometry([0, null, 50, 100], 102, 22, 0);
    expect(geom?.runs).toHaveLength(2);
    // x positions stay on the 4-sample grid: 1, 34.33, 67.67, 101.
    expect(geom?.runs[0].line).toBe("M1,20");
    expect(geom?.runs[1].line).toBe("M67.67,11L101,2");
  });

  it("anchors the latest-value dot on the last reading, skipping trailing gaps", () => {
    const geom = buildSparkGeometry([0, 100, null], 102, 22, 0);
    // Last reading is index 1 → x = 51, y = 2.
    expect(geom?.dot?.left).toBeCloseTo(50, 5);
    expect(geom?.dot?.top).toBeCloseTo((2 / 22) * 100, 5);
  });

  it("returns null when there is nothing to trend", () => {
    expect(buildSparkGeometry([], 102, 22)).toBeNull();
    expect(buildSparkGeometry([5], 102, 22)).toBeNull();
    expect(buildSparkGeometry([5, null], 102, 22)).toBeNull();
    expect(buildSparkGeometry([null, null, null], 102, 22)).toBeNull();
  });
});

describe("Sparkline", () => {
  it("renders a labelled chart whose path matches the geometry", () => {
    render(<Sparkline data={[0, 50, 100]} label="Speed" width={102} height={22} floor={0} />);
    expect(screen.getByRole("img", { name: "Speed" })).toBeInTheDocument();
    expect(screen.getByTestId("sparkline-path")).toHaveAttribute("d", "M1,20L51,11L101,2");
    expect(screen.getByTestId("sparkline-dot")).toBeInTheDocument();
  });

  it("renders nothing for a series with fewer than two readings", () => {
    const { container } = render(<Sparkline data={[42]} label="Speed" />);
    expect(container).toBeEmptyDOMElement();
  });
});

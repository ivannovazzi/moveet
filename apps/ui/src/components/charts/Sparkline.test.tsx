import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildSeries } from "./geometry";
import { Sparkline, type SparklineProps } from "./Sparkline";

/** Nominal box used by most assertions: plot x ∈ [3, 99], y ∈ [3, 19]. */
const W = 102;
const H = 22;
const SPARK_INSETS = { top: 3, right: 3, bottom: 3, left: 3 };

/**
 * Render into an isolated container so several sparks can be compared inside
 * one test without `screen` seeing them all at once.
 */
function spark(props: SparklineProps) {
  const { container } = render(<Sparkline width={W} height={H} {...props} />);
  const q = within(container);
  return {
    container,
    q,
    svg: () => container.querySelector("svg"),
    line: () => q.getByTestId("sparkline-line").getAttribute("d") ?? "",
    area: () => q.getByTestId("sparkline-area").getAttribute("d") ?? "",
  };
}

describe("Sparkline", () => {
  it("renders a labelled chart whose path matches the geometry", () => {
    const s = spark({ data: [0, 50, 100], label: "Speed", floor: 0 });

    expect(s.q.getByRole("img", { name: "Speed" })).toBeInTheDocument();
    expect(s.line()).toBe("M3,19L51,11L99,3");
    expect(s.q.getByTestId("sparkline-dot")).toBeInTheDocument();
  });

  it("stays decorative when no accessible name is given", () => {
    const s = spark({ data: [0, 50, 100] });

    expect(s.q.queryByRole("img")).not.toBeInTheDocument();
    expect(s.svg()).toHaveAttribute("aria-hidden", "true");
    expect(s.svg()).not.toHaveAttribute("aria-label");
  });

  it("renders nothing for a series with fewer than two readings", () => {
    expect(spark({ data: [] }).container).toBeEmptyDOMElement();
    expect(spark({ data: [42] }).container).toBeEmptyDOMElement();
    expect(spark({ data: [5, null] }).container).toBeEmptyDOMElement();
    expect(spark({ data: [null, null, null] }).container).toBeEmptyDOMElement();
  });

  // ─── The zero-fill regression ──────────────────────────────────────
  //
  // ETA is undefined while a vehicle is stopped. A line drawn straight through
  // that stretch claims an ETA that was never measured, so a null must produce
  // a *break* in the path, never an interpolated segment through zero.

  it("breaks the path at a null instead of interpolating through it", () => {
    const d = spark({ data: [0, null, 50, 100], label: "ETA", floor: 0 }).line();

    // Two `M` subpaths: the stroke lifts across the gap.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toBe("M3,19M67,11L99,3");
    // Nothing joins the sample before the gap to the one after it.
    expect(d).not.toContain("L67,11");
  });

  it("does not render a gapped series the way it renders a zero-filled one", () => {
    const gapped = spark({ data: [0, null, 50, 100], floor: 0 }).line();
    const zeroFilled = spark({ data: [0, 0, 50, 100], floor: 0 }).line();

    expect(zeroFilled).toBe("M3,19L35,19L67,11L99,3");
    expect(gapped).not.toBe(zeroFilled);
    expect(gapped.match(/M/g)).toHaveLength(2);
    expect(zeroFilled.match(/M/g)).toHaveLength(1);
  });

  it("breaks the area wash at the gap too", () => {
    const area = spark({ data: [0, 10, null, 10, 0], floor: 0 }).area();

    // One closed subpath per run — the wash does not span the missing stretch.
    expect(area.match(/Z/g)).toHaveLength(2);
  });

  it("anchors the end dot on the latest reading, skipping trailing gaps", () => {
    const s = spark({ data: [0, 100, null], floor: 0 });

    // Three slots on the axis; the last reading is the middle one.
    expect(s.q.getByTestId("sparkline-dot")).toHaveStyle({ left: "50%" });
  });

  // ─── Pinned floor ──────────────────────────────────────────────────

  it("pins the axis to `floor` so a steady series is not drawn as a full climb", () => {
    const autoScaled = spark({ data: [20, 30] }).line();
    const pinned = spark({ data: [20, 30], floor: 0 }).line();

    // Auto-scaled: 20 sits on the baseline of the box.
    expect(autoScaled).toBe("M3,19L99,3");
    // Pinned at 0: the same two readings sit close together near the top.
    expect(pinned).toBe("M3,8.33L99,3");
    expect(pinned).not.toBe(autoScaled);
  });

  // ─── Chart-side behaviour, unchanged ───────────────────────────────

  it("projects a plain number series exactly as the shared geometry does", () => {
    const data = [12, 18, 9, 21];
    const s = spark({ data });

    const expected = buildSeries(
      data.map((y, x) => ({ x, y })),
      { width: W, height: H, insets: SPARK_INSETS }
    );
    expect(s.line()).toBe(expected?.line);
    expect(s.area()).toBe(expected?.area);
  });

  it("takes the theme hue by default and an explicit colour when given", () => {
    expect(spark({ data: [1, 2] }).q.getByTestId("sparkline-line")).toHaveAttribute(
      "stroke",
      "var(--color-accent)"
    );
    expect(
      spark({ data: [1, 2], color: "var(--color-status-ok)" }).q.getByTestId("sparkline-line")
    ).toHaveAttribute("stroke", "var(--color-status-ok)");
  });

  it("sizes the viewBox from its props so the tile can be any width", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} width={200} height={30} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("viewBox", "0 0 200 30");
    expect(svg).toHaveAttribute("height", "30");
    expect(svg).toHaveAttribute("preserveAspectRatio", "none");
  });
});

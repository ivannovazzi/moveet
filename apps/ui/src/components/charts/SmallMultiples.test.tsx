import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SeriesTable } from "./SeriesTable";
import { SmallMultiples } from "./SmallMultiples";
import { FACET_INSETS, type FacetSeries } from "./TimeSeriesFacet";
import { buildSeries } from "./geometry";

const T0 = Date.UTC(2026, 6, 25, 10, 0, 0);
const STEP = 5000;
const timestamps = [T0, T0 + STEP, T0 + 2 * STEP, T0 + 3 * STEP, T0 + 4 * STEP];

const speed: FacetSeries = {
  id: "speed",
  label: "Avg speed",
  unit: "km/h",
  values: [10, 20, 30, 20, 40],
  format: (v) => v.toFixed(1),
};

const active: FacetSeries = {
  id: "active",
  label: "Active vehicles",
  unit: "veh",
  values: [1, 2, 3, 4, 5],
  format: (v) => String(Math.round(v)),
};

// jsdom has no layout, so `useElementWidth` reports the component's fallback.
const FALLBACK_WIDTH = 320;
const FACET_HEIGHT = 54;

function expectedGeometry(series: FacetSeries) {
  return buildSeries(
    series.values.map((y, i) => ({ x: timestamps[i], y })),
    {
      width: FALLBACK_WIDTH,
      height: FACET_HEIGHT,
      insets: FACET_INSETS,
      xDomain: [timestamps[0], timestamps[timestamps.length - 1]],
      tickCount: 2,
    }
  );
}

describe("SmallMultiples", () => {
  it("renders one facet per series", () => {
    render(<SmallMultiples timestamps={timestamps} series={[active, speed]} />);

    expect(screen.getByTestId("facet-active")).toBeInTheDocument();
    expect(screen.getByTestId("facet-speed")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Avg speed over time" })).toBeInTheDocument();
  });

  it("maps the data to the expected path geometry", () => {
    render(<SmallMultiples timestamps={timestamps} series={[speed]} />);

    const expected = expectedGeometry(speed);
    expect(expected).not.toBeNull();
    expect(screen.getByTestId("facet-line-speed")).toHaveAttribute("d", expected?.line);

    // Sanity-check the mapping independently of buildSeries: five evenly
    // spaced samples land on the plot box's left edge, midpoint and right edge.
    const xs = expected?.points.map((p) => p.x);
    expect(xs?.[0]).toBe(FACET_INSETS.left);
    expect(xs?.[4]).toBe(FALLBACK_WIDTH - FACET_INSETS.right);
    expect(xs?.[2]).toBe((FACET_INSETS.left + FALLBACK_WIDTH - FACET_INSETS.right) / 2);
  });

  it("shares one time axis across the facets", () => {
    render(<SmallMultiples timestamps={timestamps} series={[active, speed]} />);

    // Exactly one axis for the whole stack, not one per facet.
    const axes = screen.getAllByTestId("shared-time-axis");
    expect(axes).toHaveLength(1);
    expect(axes[0].textContent).toMatch(/^\d{2}:\d{2}\d{2}:\d{2}\d{2}:\d{2}$/);

    // Both facets project onto the identical x positions, which is what makes
    // them readable against each other.
    const activeXs = expectedGeometry(active)?.points.map((p) => p.x);
    const speedXs = expectedGeometry(speed)?.points.map((p) => p.x);
    expect(activeXs).toEqual(speedXs);
  });

  it("shows the latest value in each facet until a sample is selected", () => {
    render(<SmallMultiples timestamps={timestamps} series={[speed]} />);
    expect(screen.getByTestId("facet-speed")).toHaveTextContent("40.0");
    expect(screen.getByTestId("small-multiples-readout")).toHaveTextContent(/^latest ·/);
  });

  it("moves the crosshair in every facet from the keyboard", async () => {
    const user = userEvent.setup();
    render(<SmallMultiples timestamps={timestamps} series={[active, speed]} />);

    expect(screen.queryByTestId("facet-crosshair-speed")).not.toBeInTheDocument();

    const plot = screen.getByRole("group", { name: "Avg speed over time" });
    plot.focus();
    await user.keyboard("{Home}");

    // One facet was driven; both facets show the crosshair — the shared axis.
    expect(screen.getByTestId("facet-crosshair-speed")).toBeInTheDocument();
    expect(screen.getByTestId("facet-crosshair-active")).toBeInTheDocument();

    // The direct labels now read the selected sample, not the latest.
    expect(screen.getByTestId("facet-speed")).toHaveTextContent("10.0");
    expect(screen.getByTestId("facet-active")).toHaveTextContent("1");

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByTestId("facet-speed")).toHaveTextContent("30.0");
    expect(screen.getByTestId("facet-active")).toHaveTextContent("3");
  });

  it("places the crosshair at the selected sample's x position", async () => {
    const user = userEvent.setup();
    render(<SmallMultiples timestamps={timestamps} series={[speed]} />);

    screen.getByRole("group", { name: "Avg speed over time" }).focus();
    await user.keyboard("{Home}");

    const expected = expectedGeometry(speed);
    const line = screen.getByTestId("facet-crosshair-speed").querySelector("line");
    expect(line).toHaveAttribute("x1", String(expected?.points[0].x));
  });

  it("renders nothing below two samples rather than blank axes", () => {
    const { container } = render(
      <SmallMultiples timestamps={[T0]} series={[{ ...speed, values: [10] }]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no series", () => {
    const { container } = render(<SmallMultiples timestamps={timestamps} series={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SeriesTable", () => {
  it("lists every sample newest-first as text", () => {
    render(<SeriesTable timestamps={timestamps} series={[active, speed]} />);

    const rows = screen.getAllByRole("row");
    // header + 5 samples
    expect(rows).toHaveLength(6);

    const firstDataRow = rows[1];
    expect(firstDataRow).toHaveTextContent("5");
    expect(firstDataRow).toHaveTextContent("40.0");

    expect(screen.getByRole("columnheader", { name: /Avg speed/ })).toBeInTheDocument();
  });

  it("caps the row count", () => {
    render(<SeriesTable timestamps={timestamps} series={[speed]} maxRows={2} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

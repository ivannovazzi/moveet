import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import LegendStack, { LEGEND_ORDER, renderInSlot } from "./LegendStack";

describe("LegendStack", () => {
  it("is one labelled column", () => {
    render(<LegendStack />);
    const stack = screen.getByRole("group", { name: "Map legends" });
    expect(stack.className).toContain("flex-col");
    // The box spans the whole height budget whether or not it holds anything,
    // so it must never swallow a drag on the map underneath it.
    expect(stack.className).toContain("pointer-events-none");
    expect(stack.className).not.toContain("pointer-events-auto");
  });

  it("renders its legends in the order it was given them", () => {
    render(
      <LegendStack>
        <div data-testid="legend">density</div>
        <div data-testid="legend">traffic</div>
        <div data-testid="legend">heat</div>
      </LegendStack>
    );
    expect(screen.getAllByTestId("legend").map((el) => el.textContent)).toEqual([
      "density",
      "traffic",
      "heat",
    ]);
  });

  it("reserves the rail's band so the two columns can never meet", () => {
    render(<LegendStack />);
    const stack = screen.getByRole("group", { name: "Map legends" });
    expect(stack.className).toContain("var(--legend-stack-clearance)");
    // Percentage of the map pane, not of the viewport: the pane is shorter.
    expect(stack.className).toContain("calc(100%-");
    // …with a floor, or a short pane clamps the budget to zero and hides every
    // legend instead of scrolling them.
    expect(stack.className).toContain("max(140px,");
  });

  it("starts on the shared row-two baseline, not a hand-picked offset", () => {
    render(<LegendStack />);
    const stack = screen.getByRole("group", { name: "Map legends" });
    // One token for every surface that starts below the search bar (the stack,
    // the start hint, the inspector), and the same token in the height budget.
    expect(stack.className).toContain("top-[var(--spacing-row-2)]");
    expect(stack.className).toContain("left-3");
    expect(stack.className).toContain("var(--spacing-row-2)-var(--spacing-above-dock)");
  });

  it("keeps the column click-through until it actually has to scroll", () => {
    const { container } = render(<LegendStack />);
    const column = container.querySelector("[role='group'] > div") as HTMLElement;
    // jsdom reports no layout, so nothing overflows: the column stays out of
    // the pointer's way and only clips.
    expect(column.className).not.toContain("pointer-events-auto");
    expect(column.className).toContain("overflow-hidden");
  });
});

describe("renderInSlot", () => {
  it("keeps the portalled wrapper click-through", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const ref = { current: slot as HTMLElement | null };

    render(<div>{renderInSlot(ref, "heat", <span>legend</span>)}</div>);

    const wrapper = slot.querySelector<HTMLElement>("[data-legend-slot='heat']");
    // A legend is read, not operated: the map has to stay draggable under it.
    expect(wrapper?.className).toContain("pointer-events-none");
    slot.remove();
  });

  it("renders inline when there is no stack yet", () => {
    render(<div data-testid="host">{renderInSlot(undefined, "heat", <span>legend</span>)}</div>);
    expect(screen.getByTestId("host")).toHaveTextContent("legend");
  });

  it("renders inline when the slot ref is still empty", () => {
    const ref = createRef<HTMLElement>();
    render(<div data-testid="host">{renderInSlot(ref, "heat", <span>legend</span>)}</div>);
    expect(screen.getByTestId("host")).toHaveTextContent("legend");
  });

  it("portals into the slot once it is attached", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const ref = { current: slot as HTMLElement | null };

    render(<div data-testid="host">{renderInSlot(ref, "traffic", <span>legend</span>)}</div>);

    expect(screen.getByTestId("host")).toHaveTextContent("");
    expect(slot.textContent).toBe("legend");
    slot.remove();
  });

  it("fixes the column order regardless of which overlay mounted first", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const ref = { current: slot as HTMLElement | null };

    // Heat first, density last — the order lazy chunks might actually resolve
    // in, and the order re-toggling a layer produces.
    render(
      <>
        {renderInSlot(ref, "heat", <span>heat</span>)}
        {renderInSlot(ref, "density", <span>density</span>)}
      </>
    );

    const wrappers = Array.from(slot.querySelectorAll<HTMLElement>("[data-legend-slot]"));
    // DOM order is mount order …
    expect(wrappers.map((el) => el.dataset.legendSlot)).toEqual(["heat", "density"]);
    // … and flex order puts them back the way the reader expects.
    expect(wrappers.map((el) => el.style.order)).toEqual([
      String(LEGEND_ORDER.heat),
      String(LEGEND_ORDER.density),
    ]);
    expect(LEGEND_ORDER.density).toBeLessThan(LEGEND_ORDER.traffic);
    expect(LEGEND_ORDER.traffic).toBeLessThan(LEGEND_ORDER.heat);
    slot.remove();
  });

  it("reserves the fleets slot after heat", () => {
    expect(LEGEND_ORDER.heat).toBeLessThan(LEGEND_ORDER.fleets);
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import LegendStack, { LEGEND_ORDER, renderInSlot } from "./LegendStack";

describe("LegendStack", () => {
  it("is one labelled column", () => {
    render(<LegendStack />);
    const stack = screen.getByRole("group", { name: "Map legends" });
    expect(stack.className).toContain("flex-col");
    // It takes the pointer so the column can scroll; the legends inside stay
    // click-through, and an empty stack has no height to swallow drags with.
    expect(stack.className).toContain("pointer-events-auto");
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
  });

  it("scrolls rather than clipping a legend away on a short map", () => {
    render(<LegendStack />);
    expect(screen.getByRole("group", { name: "Map legends" }).className).toContain(
      "overflow-y-auto"
    );
  });
});

describe("renderInSlot", () => {
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
});

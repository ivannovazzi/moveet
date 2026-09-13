import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import LegendStack, { renderInSlot } from "./LegendStack";

describe("LegendStack", () => {
  it("is one labelled, click-through column", () => {
    render(<LegendStack />);
    const stack = screen.getByRole("group", { name: "Map legends" });
    expect(stack.className).toContain("pointer-events-none");
    expect(stack.className).toContain("flex-col");
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
    expect(screen.getByRole("group", { name: "Map legends" }).className).toContain(
      "var(--legend-stack-clearance)"
    );
  });
});

describe("renderInSlot", () => {
  it("renders inline when there is no stack yet", () => {
    render(<div data-testid="host">{renderInSlot(undefined, <span>legend</span>)}</div>);
    expect(screen.getByTestId("host")).toHaveTextContent("legend");
  });

  it("renders inline when the slot ref is still empty", () => {
    const ref = createRef<HTMLElement>();
    render(<div data-testid="host">{renderInSlot(ref, <span>legend</span>)}</div>);
    expect(screen.getByTestId("host")).toHaveTextContent("legend");
  });

  it("portals into the slot once it is attached", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const ref = { current: slot as HTMLElement | null };

    render(<div data-testid="host">{renderInSlot(ref, <span>legend</span>)}</div>);

    expect(screen.getByTestId("host")).toHaveTextContent("");
    expect(slot.textContent).toBe("legend");
  });
});

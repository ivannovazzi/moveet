import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

describe("shadcn primitives smoke", () => {
  it("renders a button with its accessible name", () => {
    render(<Button>ok</Button>);
    expect(screen.getByRole("button", { name: "ok" })).toBeInTheDocument();
  });

  it("renders a switch", () => {
    render(<Switch aria-label="toggle" />);
    expect(screen.getByRole("switch", { name: "toggle" })).toBeInTheDocument();
  });

  it("draws the tooltip arrow as Radix's own filled polygon", async () => {
    // Regression, twice over. The arrow used to be the svg BOX styled into a
    // rotated bordered square, which only lines up for `side="top"` — Radix
    // rotates the arrow's wrapper per side, so anywhere else it drew the wrong
    // edges and sat outside the bubble. And the `<polygon>` Radix renders
    // inside carried no `fill`, so it painted solid black over the glass.
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent side="bottom">details</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await waitFor(() => expect(screen.getAllByText("details").length).toBeGreaterThan(0));

    const arrow = document.querySelector("polygon")?.closest("svg");
    expect(arrow).toBeInTheDocument();
    // The polygon is the arrow, so it must be filled...
    // Opaque, not a translucent glass stop: the arrow has no backdrop-filter,
    // so a 55%-alpha fill disappears into the map behind it.
    expect(arrow?.getAttribute("class")).toContain("fill-popover");
    // ...and tucked a pixel into the bubble, so its base covers the content's
    // top border rather than perching on the light 1px line, which is what made
    // it read as a blob stuck onto the box.
    expect(arrow?.getAttribute("class")).toContain("-translate-y-px");
    // None of the rotated-square geometry may come back.
    expect(arrow?.getAttribute("class")).not.toContain("rotate-45");
    expect(arrow?.getAttribute("class")).not.toContain("fill-transparent");
  });
});

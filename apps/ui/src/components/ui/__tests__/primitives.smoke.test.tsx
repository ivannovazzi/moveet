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

  it("draws the tooltip arrow as the rotated square, not Radix's polygon", async () => {
    // Regression: the arrow's styling makes the svg BOX the arrow (rotate-45,
    // two borders, glass fill). The `<polygon>` Radix renders inside it has no
    // fill attribute, so it defaults to solid black and covers the glass — a
    // black triangle under every tooltip. It went unnoticed until the primitive
    // got its first caller.
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>details</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await waitFor(() => expect(screen.getAllByText("details").length).toBeGreaterThan(0));
    const arrow = document.querySelector("svg.rotate-45");
    expect(arrow).toBeInTheDocument();
    expect(arrow?.getAttribute("class")).toContain("fill-transparent");
  });
});

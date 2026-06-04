import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

describe("shadcn primitives smoke", () => {
  it("renders a button with its accessible name", () => {
    render(<Button>ok</Button>);
    expect(screen.getByRole("button", { name: "ok" })).toBeInTheDocument();
  });

  it("renders a switch", () => {
    render(<Switch aria-label="toggle" />);
    expect(screen.getByRole("switch", { name: "toggle" })).toBeInTheDocument();
  });
});

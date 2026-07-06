import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PanelRow, RowDeleteButton } from "../PanelPrimitives";

describe("PanelRow", () => {
  it("renders a static div row (divider, padding, hover tone) by default", () => {
    render(<PanelRow data-testid="row">content</PanelRow>);
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("DIV");
    expect(row.className).toContain("border-b");
    expect(row.className).toContain("px-2.5");
    expect(row.className).toContain("hover:bg-white/[0.04]");
  });

  it("renders an interactive button with focus ring when onClick is set", async () => {
    const onClick = vi.fn();
    render(<PanelRow onClick={onClick}>Row</PanelRow>);
    const row = screen.getByRole("button", { name: "Row" });
    expect(row).toHaveAttribute("type", "button");
    expect(row.className).toContain("focus-visible:ring-[3px]");
    expect(row.className).toContain("w-full");
    await userEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies the selected accent inset-bar treatment", () => {
    render(
      <PanelRow data-testid="row" selected>
        x
      </PanelRow>
    );
    const row = screen.getByTestId("row");
    expect(row.className).toContain("bg-accent/10");
    expect(row.className).toContain("shadow-[inset_2px_0_0_var(--color-accent)]");
  });

  it("can disable the hover tone for informational rows", () => {
    render(
      <PanelRow data-testid="row" hoverable={false}>
        x
      </PanelRow>
    );
    expect(screen.getByTestId("row").className).not.toContain("hover:bg-white/[0.04]");
  });

  it("honors an explicit `as` element override", () => {
    render(
      <PanelRow data-testid="row" as="div">
        x
      </PanelRow>
    );
    expect(screen.getByTestId("row").tagName).toBe("DIV");
  });
});

describe("RowDeleteButton", () => {
  it("renders a danger delete action named and titled by its label", async () => {
    const onClick = vi.fn();
    render(<RowDeleteButton label="Delete fleet" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Delete fleet" });
    expect(btn).toHaveAttribute("title", "Delete fleet");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

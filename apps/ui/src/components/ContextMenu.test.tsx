import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContextMenu from "./ContextMenu";

// Positioning, focus-trap and outside-click are now owned by the Radix
// DropdownMenu primitive, so these tests cover the surface contract this
// wrapper is responsible for: open/closed driven by `position`, the menu
// surface + aria-label, portaling, and Escape → onClose.
describe("ContextMenu", () => {
  const position = { x: 100, y: 100 };

  it("renders children inside a menu surface when position is provided", () => {
    render(
      <ContextMenu position={position}>
        <button>Test Action</button>
      </ContextMenu>
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Test Action")).toBeInTheDocument();
  });

  it("renders no menu when position is null", () => {
    render(
      <ContextMenu position={null}>
        <button>Should Not Render</button>
      </ContextMenu>
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByText("Should Not Render")).not.toBeInTheDocument();
  });

  it("labels the menu for assistive tech", () => {
    render(
      <ContextMenu position={position}>
        <button>Action</button>
      </ContextMenu>
    );
    expect(screen.getByRole("menu")).toHaveAttribute("aria-label", "Context menu");
  });

  it("portals the menu out of the local subtree", () => {
    render(
      <div data-testid="wrapper">
        <ContextMenu position={position}>
          <button>Action</button>
        </ContextMenu>
      </div>
    );
    const menu = screen.getByRole("menu");
    expect(menu.closest("[data-testid='wrapper']")).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu position={position} onClose={onClose}>
        <button>Action</button>
      </ContextMenu>
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContextMenu from "./ContextMenu";

// Mock @react-aria/focus to avoid jsdom focus-management issues
vi.mock("@react-aria/focus", () => ({
  FocusScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("ContextMenu", () => {
  const defaultPosition = { x: 100, y: 100 };

  beforeEach(() => {
    // Reset getBoundingClientRect mock
    vi.restoreAllMocks();
    // Set default viewport dimensions
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when position is provided", () => {
    render(
      <ContextMenu position={defaultPosition}>
        <button>Test Action</button>
      </ContextMenu>
    );
    expect(screen.getByText("Test Action")).toBeInTheDocument();
  });

  it("renders the menu with role=menu", () => {
    render(
      <ContextMenu position={defaultPosition}>
        <button>Action</button>
      </ContextMenu>
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("returns null when position is falsy", () => {
    const { container } = render(
      <ContextMenu position={null as unknown as { x: number; y: number }}>
        <button>Should Not Render</button>
      </ContextMenu>
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(container.innerHTML).toBe("");
  });

  it("positions menu at provided coordinates", () => {
    // Mock getBoundingClientRect to return a small menu that fits within viewport
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 150,
      top: 100,
      left: 100,
      right: 300,
      bottom: 250,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 100, y: 100 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.position).toBe("fixed");
    // After layout effect, position should be applied
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("100px");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu position={defaultPosition} onClose={onClose}>
        <button>Action</button>
      </ContextMenu>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on outside click", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <ContextMenu position={defaultPosition} onClose={onClose}>
          <button>Action</button>
        </ContextMenu>
      </div>
    );

    // Click outside the menu
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking inside the menu", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu position={defaultPosition} onClose={onClose}>
        <button>Action</button>
      </ContextMenu>
    );

    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adjusts position when menu would overflow right edge", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      writable: true,
      configurable: true,
    });

    // Menu at x=700 with width=200 => right edge at 900, exceeds viewport 800
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 150,
      top: 100,
      left: 700,
      right: 900, // exceeds window.innerWidth (800)
      bottom: 250,
      x: 700,
      y: 100,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 700, y: 100 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    // x should be adjusted: 700 - 200 = 500
    expect(menu.style.left).toBe("500px");
    expect(menu.style.top).toBe("100px");
  });

  it("adjusts position when menu would overflow bottom edge", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      writable: true,
      configurable: true,
    });

    // Menu at y=500 with height=300 => bottom edge at 800, exceeds viewport 600
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 300,
      top: 500,
      left: 100,
      right: 300,
      bottom: 800, // exceeds window.innerHeight (600)
      x: 100,
      y: 500,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 100, y: 500 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    // y should be adjusted: 500 - 300 = 200
    expect(menu.style.top).toBe("200px");
  });

  it("adjusts position when menu overflows both right and bottom edges", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      writable: true,
      configurable: true,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 300,
      top: 500,
      left: 700,
      right: 900, // exceeds 800
      bottom: 800, // exceeds 600
      x: 700,
      y: 500,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 700, y: 500 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    // x: 700 - 200 = 500, y: 500 - 300 = 200
    expect(menu.style.left).toBe("500px");
    expect(menu.style.top).toBe("200px");
  });

  it("clamps position to not go negative on x axis", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      writable: true,
      configurable: true,
    });

    // Menu at x=50 with width=200 and right > innerWidth triggers adjustment:
    // adjusted.x = 50 - 200 = -150, then clamped to 0
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 100,
      top: 100,
      left: 50,
      right: 850, // exceeds 800 to trigger x adjustment
      bottom: 200,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 50, y: 100 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    // x: 50 - 200 = -150, clamped to 0
    expect(menu.style.left).toBe("0px");
    expect(menu.style.top).toBe("100px");
  });

  it("clamps position to not go negative on y axis", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      writable: true,
      configurable: true,
    });

    // Menu at y=50 with height=300 and bottom > innerHeight triggers adjustment:
    // adjusted.y = 50 - 300 = -250, then clamped to 0
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 300,
      top: 50,
      left: 100,
      right: 300,
      bottom: 650, // exceeds 600 to trigger y adjustment
      x: 100,
      y: 50,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 100, y: 50 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    // y: 50 - 300 = -250, clamped to 0
    expect(menu.style.top).toBe("0px");
  });

  it("does not adjust position when menu fits within viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 150,
      top: 100,
      left: 100,
      right: 300, // well within 1024
      bottom: 250, // well within 768
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    render(
      <ContextMenu position={{ x: 100, y: 100 }}>
        <button>Action</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("100px");
  });

  it("renders into a portal on document.body", () => {
    const { baseElement } = render(
      <div data-testid="wrapper">
        <ContextMenu position={defaultPosition}>
          <button>Action</button>
        </ContextMenu>
      </div>
    );

    // The menu should be a child of document.body, not the wrapper div
    const menu = screen.getByRole("menu");
    expect(menu.closest("[data-testid='wrapper']")).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
  });

  it("has correct aria-label", () => {
    render(
      <ContextMenu position={defaultPosition}>
        <button>Action</button>
      </ContextMenu>
    );
    expect(screen.getByRole("menu")).toHaveAttribute("aria-label", "Context menu");
  });

  it("cleans up event listeners on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ContextMenu position={defaultPosition} onClose={onClose}>
        <button>Action</button>
      </ContextMenu>
    );

    unmount();

    // After unmount, events should not trigger onClose
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document);
    expect(onClose).not.toHaveBeenCalled();
  });
});

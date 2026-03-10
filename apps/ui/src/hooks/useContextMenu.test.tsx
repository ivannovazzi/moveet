import { describe, it, expect } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import useContextMenu from "./useContextMenu";

function TestComponent() {
  const [onContextMenu, ref, position, close] = useContextMenu();
  return (
    <div>
      <div data-testid="trigger" onContextMenu={onContextMenu}>
        trigger
      </div>
      <div data-testid="menu" ref={ref}>
        {position ? `${position.x},${position.y}` : "closed"}
      </div>
      <button data-testid="close" onClick={close}>
        close
      </button>
    </div>
  );
}

describe("useContextMenu", () => {
  it("initially returns null position", () => {
    render(<TestComponent />);
    expect(screen.getByTestId("menu")).toHaveTextContent("closed");
  });

  it("handleContextMenu sets position from event clientX/clientY and calls preventDefault", () => {
    render(<TestComponent />);
    const trigger = screen.getByTestId("trigger");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 250,
    });
    const preventDefaultSpy = vi.spyOn(contextMenuEvent, "preventDefault");

    act(() => {
      trigger.dispatchEvent(contextMenuEvent);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(screen.getByTestId("menu")).toHaveTextContent("120,250");
  });

  it("close function resets position to null", () => {
    render(<TestComponent />);
    const trigger = screen.getByTestId("trigger");

    fireEvent.contextMenu(trigger, { clientX: 100, clientY: 200 });
    expect(screen.getByTestId("menu")).toHaveTextContent("100,200");

    fireEvent.click(screen.getByTestId("close"));
    expect(screen.getByTestId("menu")).toHaveTextContent("closed");
  });

  it("clicking outside the ref element closes the menu", () => {
    render(<TestComponent />);
    const trigger = screen.getByTestId("trigger");

    fireEvent.contextMenu(trigger, { clientX: 50, clientY: 60 });
    expect(screen.getByTestId("menu")).toHaveTextContent("50,60");

    // Click on the trigger, which is outside the menu ref
    fireEvent.click(trigger);
    expect(screen.getByTestId("menu")).toHaveTextContent("closed");
  });

  it("clicking inside the ref element does NOT close the menu", () => {
    render(<TestComponent />);
    const trigger = screen.getByTestId("trigger");

    fireEvent.contextMenu(trigger, { clientX: 70, clientY: 80 });
    expect(screen.getByTestId("menu")).toHaveTextContent("70,80");

    // Click inside the menu element (which has the ref)
    fireEvent.click(screen.getByTestId("menu"));
    expect(screen.getByTestId("menu")).toHaveTextContent("70,80");
  });
});

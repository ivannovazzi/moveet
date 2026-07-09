import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import useContextMenu from "./useContextMenu";

function TestComponent() {
  const [onContextMenu, position, close] = useContextMenu();
  return (
    <div>
      <div data-testid="trigger" onContextMenu={onContextMenu}>
        trigger
      </div>
      <div data-testid="state">{position ? `${position.x},${position.y}` : "closed"}</div>
      <button data-testid="close" onClick={close}>
        close
      </button>
    </div>
  );
}

describe("useContextMenu", () => {
  it("initially returns a null position", () => {
    render(<TestComponent />);
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("captures clientX/clientY and prevents the native menu on contextmenu", () => {
    render(<TestComponent />);
    const trigger = screen.getByTestId("trigger");

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 250,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    act(() => {
      trigger.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("120,250");
  });

  it("close() resets the position to null", () => {
    render(<TestComponent />);
    fireEvent.contextMenu(screen.getByTestId("trigger"), {
      clientX: 100,
      clientY: 200,
    });
    expect(screen.getByTestId("state")).toHaveTextContent("100,200");

    fireEvent.click(screen.getByTestId("close"));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import VehicleList from "./Vehicles";
import { createVehicle } from "@/test/mocks/types";

/**
 * The vehicle list is virtualized: with a large roster it must render a small
 * window of rows, position them by index * row height, and swap that window as
 * the container scrolls. Type-checking cannot catch a wrong prop mapping here —
 * a list that renders nothing, renders everything, or stacks every row at
 * offset 0 all type-check cleanly — so these assertions read the real DOM
 * geometry the renderer produces.
 */

// Matches ROW_HEIGHT / FALLBACK_LIST_HEIGHT in Vehicles.tsx. jsdom's
// ResizeObserver polyfill never fires, so the list falls back to 400px.
const ROW_HEIGHT = 30;
const LIST_HEIGHT = 400;

const baseProps = {
  filter: "",
  maxSpeed: 100,
  vehicleFleetMap: new Map(),
  onFilterChange: vi.fn(),
  onSelectVehicle: vi.fn(),
  onHoverVehicle: vi.fn(),
  onUnhoverVehicle: vi.fn(),
};

function roster(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createVehicle({ id: `v${i}`, name: `Unit ${i}`, visible: true })
  );
}

/** Rendered row slots, in DOM order, with their resolved geometry. */
function renderedRows() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listitem"]')).map((el) => ({
    name: el.querySelector("button")?.getAttribute("aria-label")?.split(",")[0] ?? "",
    height: el.style.height,
    transform: el.style.transform,
  }));
}

describe("VehicleList virtualization", () => {
  it("renders only a window of rows for a large roster", () => {
    render(<VehicleList {...baseProps} vehicles={roster(500)} />);

    const rows = renderedRows();
    // A 400px viewport of 30px rows plus overscan — far fewer than 500, but
    // enough to fill the visible area.
    expect(rows.length).toBeGreaterThanOrEqual(Math.floor(LIST_HEIGHT / ROW_HEIGHT));
    expect(rows.length).toBeLessThan(50);

    // The window starts at the top of the roster.
    expect(rows[0].name).toBe("Unit 0");
    expect(screen.getByText("Unit 0")).toBeInTheDocument();
    expect(screen.queryByText("Unit 400")).not.toBeInTheDocument();
  });

  it("sizes and stacks rows by index * row height", () => {
    render(<VehicleList {...baseProps} vehicles={roster(500)} />);

    const rows = renderedRows();
    rows.forEach((row, index) => {
      expect(row.height).toBe(`${ROW_HEIGHT}px`);
      expect(row.transform).toBe(`translateY(${index * ROW_HEIGHT}px)`);
    });
  });

  it("reserves scrollable height for the whole roster", () => {
    render(<VehicleList {...baseProps} vehicles={roster(500)} />);

    const list = document.querySelector<HTMLElement>('[role="list"]');
    expect(list).not.toBeNull();
    expect(list!.style.overflowY).toBe("auto");

    // The spacer element sized to the full content keeps the scrollbar honest.
    const spacer = list!.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(spacer?.style.height).toBe(`${500 * ROW_HEIGHT}px`);
  });

  it("swaps the rendered window when the list scrolls", () => {
    render(<VehicleList {...baseProps} vehicles={roster(500)} />);

    const list = document.querySelector<HTMLElement>('[role="list"]')!;
    act(() => {
      // jsdom does not lay out, so drive scrollTop and the scroll event by hand.
      Object.defineProperty(list, "scrollTop", { value: 100 * ROW_HEIGHT, writable: true });
      list.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByText("Unit 100")).toBeInTheDocument();
    expect(screen.queryByText("Unit 0")).not.toBeInTheDocument();
  });
});

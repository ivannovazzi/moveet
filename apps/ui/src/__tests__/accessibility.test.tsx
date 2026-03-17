import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import VehicleList from "@/Controls/Vehicles";
import ContextMenu from "@/components/ContextMenu";
import MapContextMenu from "@/components/MapContextMenu";
import { DispatchState } from "@/hooks/useDispatchState";
import { createVehicle } from "@/test/mocks/types";

// ---------------------------------------------------------------------------
// Mock canvas context — jsdom does not implement CanvasRenderingContext2D
// ---------------------------------------------------------------------------
function createMockContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === "canvas") return { width: 800, height: 600 };
      if (
        typeof prop === "string" &&
        ![
          "fillStyle",
          "strokeStyle",
          "lineWidth",
          "shadowColor",
          "shadowBlur",
          "shadowOffsetX",
          "shadowOffsetY",
        ].includes(prop)
      ) {
        return (..._args: unknown[]) => {};
      }
      return undefined;
    },
    set() {
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

// ---------------------------------------------------------------------------
// Mock the map context for VehiclesLayer
// ---------------------------------------------------------------------------
const mockProjection = vi.fn(
  (pos: [number, number]) => [pos[0] * 10, pos[1] * 10] as [number, number]
);
(mockProjection as unknown as { invert: unknown }).invert = vi.fn();

const mockTransform = { k: 1, x: 0, y: 0 };

const mockMapElement = document.createElement("svg");
const mockContainer = document.createElement("div");
mockContainer.style.position = "relative";
mockContainer.appendChild(mockMapElement);
document.body.appendChild(mockContainer);

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    projection: mockProjection,
    transform: mockTransform,
    map: mockMapElement,
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
    getZoom: () => 1,
  }),
}));

// Import AFTER mocks
import VehiclesLayer from "@/Map/Vehicle/VehiclesLayer";

// ---------------------------------------------------------------------------
// 1. VehiclesLayer canvas ARIA attributes
// ---------------------------------------------------------------------------
describe("VehiclesLayer accessibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vehicleStore.replace([]);

    HTMLCanvasElement.prototype.getContext = function () {
      return createMockContext();
    } as typeof HTMLCanvasElement.prototype.getContext;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      return setTimeout(cb, 16) as unknown as number;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id);
    });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    for (const c of mockContainer.querySelectorAll("canvas")) {
      c.remove();
    }
  });

  it("canvas has role='img' and aria-label='Vehicle fleet map'", () => {
    render(
      <VehiclesLayer
        scale={1.5}
        vehicleFleetMap={new Map<string, Fleet>()}
        hiddenFleetIds={new Set<string>()}
        onClick={vi.fn()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(0);
    });

    const canvas = mockContainer.querySelector("canvas");
    expect(canvas).toBeTruthy();
    expect(canvas!.getAttribute("role")).toBe("img");
    expect(canvas!.getAttribute("aria-label")).toBe("Vehicle fleet map");
  });
});

// ---------------------------------------------------------------------------
// 2. Vehicle list item aria-labels
// ---------------------------------------------------------------------------
describe("VehicleList accessibility", () => {
  const defaultProps = {
    filter: "",
    vehicles: [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true, speed: 45 }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true, speed: 60 }),
    ],
    maxSpeed: 100,
    fleets: [],
    onFilterChange: vi.fn(),
    onSelectVehicle: vi.fn(),
    onHoverVehicle: vi.fn(),
    onUnhoverVehicle: vi.fn(),
  };

  it("each vehicle button has a descriptive aria-label", () => {
    render(<VehicleList {...defaultProps} />);

    const buttons = screen.getAllByRole("button", { pressed: false });
    // Filter out the clear-search button if present
    const vehicleButtons = buttons.filter((b) => b.getAttribute("aria-label")?.includes("km/h"));

    expect(vehicleButtons).toHaveLength(2);
    expect(vehicleButtons[0]).toHaveAttribute("aria-label", expect.stringContaining("Truck Alpha"));
    expect(vehicleButtons[0]).toHaveAttribute("aria-label", expect.stringContaining("45 km/h"));
    expect(vehicleButtons[1]).toHaveAttribute("aria-label", expect.stringContaining("Van Beta"));
    expect(vehicleButtons[1]).toHaveAttribute("aria-label", expect.stringContaining("60 km/h"));
  });

  it("checkbox spans have role='checkbox' and aria-checked in dispatch mode", () => {
    const vehicles = [
      createVehicle({ id: "v1", name: "Truck Alpha", visible: true }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true }),
    ];

    render(
      <VehicleList
        {...defaultProps}
        vehicles={vehicles}
        dispatchState={DispatchState.SELECT}
        selectedForDispatch={["v1"]}
        onToggleVehicleForDispatch={vi.fn()}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);

    // v1 is selected
    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[0]).toHaveAttribute("aria-label", "Select Truck Alpha");

    // v2 is not selected
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "false");
    expect(checkboxes[1]).toHaveAttribute("aria-label", "Select Van Beta");
  });

  it("checkbox spans are NOT rendered in browse mode", () => {
    render(<VehicleList {...defaultProps} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. ContextMenu focus management and keyboard navigation
// ---------------------------------------------------------------------------
describe("ContextMenu accessibility", () => {
  it("has role='menu' and aria-label", () => {
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <button>Action 1</button>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-label", "Context menu");
  });

  it("focuses the first focusable element when opened", () => {
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <button>First</button>
        <button>Second</button>
      </ContextMenu>
    );

    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={onClose}>
        <button>Action</button>
      </ContextMenu>
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("traps focus with Tab - wraps from last to first", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      </ContextMenu>
    );

    // Focus should start on First
    expect(document.activeElement).toBe(screen.getByText("First"));

    // Tab to Second
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("Second"));

    // Tab to Third
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("Third"));

    // Tab should wrap to First
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText("First"));
  });

  it("traps focus with Shift+Tab - wraps from first to last", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      </ContextMenu>
    );

    // Focus should start on First
    expect(document.activeElement).toBe(screen.getByText("First"));

    // Shift+Tab should wrap to Third
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText("Third"));
  });
});

// ---------------------------------------------------------------------------
// 4. MapContextMenu buttons have role="menuitem"
// ---------------------------------------------------------------------------
describe("MapContextMenu accessibility", () => {
  it("buttons have role='menuitem' in BROWSE state", () => {
    render(
      <MapContextMenu
        state={DispatchState.BROWSE}
        onFindDirections={vi.fn()}
        onFindRoad={vi.fn()}
        onSendVehicle={vi.fn()}
        onAddWaypoint={vi.fn()}
        hasSelectedVehicle={false}
        hasDispatchSelection={false}
      />
    );

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("menuitem", { name: "Find Directions To Here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Identify closest road" })).toBeInTheDocument();
  });

  it("buttons have role='menuitem' in SELECT state", () => {
    render(
      <MapContextMenu
        state={DispatchState.SELECT}
        onFindDirections={vi.fn()}
        onFindRoad={vi.fn()}
        onSendVehicle={vi.fn()}
        onAddWaypoint={vi.fn()}
        hasSelectedVehicle={false}
        hasDispatchSelection={false}
      />
    );

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems).toHaveLength(1);
    expect(menuItems[0]).toHaveTextContent("Identify closest road");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import VehicleList from "@/Controls/Vehicles";
import ContextMenu from "@/components/ContextMenu";
import MapContextMenu from "@/components/MapContextMenu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DispatchState } from "@/hooks/useDispatchState";
import { createVehicle } from "@/test/mocks/types";

// ---------------------------------------------------------------------------
// Mock useRegisterLayers for VehiclesLayer (deck.gl)
// ---------------------------------------------------------------------------
const { registeredLayers } = vi.hoisted(() => {
  const registeredLayers = new Map<string, unknown[]>();
  return { registeredLayers };
});

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
  useDeckLayersContext: () => ({
    registerLayers: () => {},
    unregisterLayers: () => {},
  }),
}));

// Import AFTER mocks
import VehiclesLayer from "@/Map/Vehicle/VehiclesLayer";

// ---------------------------------------------------------------------------
// 1. VehiclesLayer deck.gl layer properties
// ---------------------------------------------------------------------------
describe("VehiclesLayer accessibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vehicleStore.replace([]);
    registeredLayers.clear();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      return setTimeout(cb, 16) as unknown as number;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("registers pickable vehicle layers for accessible interaction", () => {
    vehicleStore.replace([
      { id: "v1", name: "V1", position: [36.82, -1.29], speed: 30, heading: 0 },
    ]);

    render(
      <VehiclesLayer
        scale={1.5}
        vehicleFleetMap={new Map<string, Fleet>()}
        hiddenFleetIds={new Set<string>()}
        hiddenVehicleTypes={new Set()}
        onClick={vi.fn()}
      />
    );

    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(16);

    expect(registeredLayers.has("vehicles")).toBe(true);
    const layers = registeredLayers.get("vehicles")!;
    const vehiclesLayer = layers.find(
      (l) => (l as { props: { id: string } }).props.id === "vehicles"
    ) as { props: { pickable: boolean } };
    expect(vehiclesLayer.props.pickable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Vehicle list item aria-labels
// ---------------------------------------------------------------------------
describe("VehicleList accessibility", () => {
  const defaultProps = {
    filter: "",
    vehicles: [
      createVehicle({
        id: "v1",
        name: "Truck Alpha",
        visible: true,
        speed: 45,
      }),
      createVehicle({ id: "v2", name: "Van Beta", visible: true, speed: 60 }),
    ],
    maxSpeed: 100,
    vehicleFleetMap: new Map(),
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
// Focus management, Tab/arrow navigation and focus return are now provided by
// the Radix DropdownMenu primitive (and covered by Radix's own tests). Here we
// assert the contract this surface owns: menu semantics, labelling, dismissal,
// and that items are exposed as keyboard-reachable menu items.
describe("ContextMenu accessibility", () => {
  it("has role='menu' and aria-label", () => {
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <DropdownMenuItem>Action 1</DropdownMenuItem>
      </ContextMenu>
    );

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-label", "Context menu");
  });

  it("exposes children as focusable menu items", () => {
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <DropdownMenuItem>First</DropdownMenuItem>
        <DropdownMenuItem>Second</DropdownMenuItem>
      </ContextMenu>
    );

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("First");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={onClose}>
        <DropdownMenuItem>Action</DropdownMenuItem>
      </ContextMenu>
    );

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. MapContextMenu buttons have role="menuitem"
// ---------------------------------------------------------------------------
describe("MapContextMenu accessibility", () => {
  function renderMenu(state: DispatchState) {
    return render(
      <DropdownMenu open modal={false}>
        <DropdownMenuContent>
          <MapContextMenu
            state={state}
            onFindDirections={vi.fn()}
            onFindRoad={vi.fn()}
            onSendVehicle={vi.fn()}
            onAddWaypoint={vi.fn()}
            hasSelectedVehicle={false}
            hasDispatchSelection={false}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it("exposes items with role='menuitem' in BROWSE state", () => {
    renderMenu(DispatchState.BROWSE);

    expect(screen.getAllByRole("menuitem").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("menuitem", { name: "Find directions to here" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Identify closest road" })).toBeInTheDocument();
  });

  it("exposes a single menu item in SELECT state", () => {
    renderMenu(DispatchState.SELECT);

    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems).toHaveLength(1);
    expect(menuItems[0]).toHaveTextContent("Identify closest road");
  });
});

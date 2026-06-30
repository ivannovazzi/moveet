import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MapContextMenu from "../MapContextMenu";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { DispatchState } from "@/hooks/useDispatchState";

function defaultProps(
  overrides: Partial<React.ComponentProps<typeof MapContextMenu>> = {}
): React.ComponentProps<typeof MapContextMenu> {
  return {
    state: DispatchState.BROWSE,
    onFindDirections: vi.fn(),
    onFindRoad: vi.fn(),
    onSendVehicle: vi.fn(),
    onAddWaypoint: vi.fn(),
    hasSelectedVehicle: false,
    hasDispatchSelection: false,
    ...overrides,
  };
}

// MapContextMenu emits Radix menu items, which require a DropdownMenu context.
function renderMenu(overrides: Partial<React.ComponentProps<typeof MapContextMenu>> = {}) {
  return render(
    <DropdownMenu open modal={false}>
      <DropdownMenuContent>
        <MapContextMenu {...defaultProps(overrides)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function itemFor(text: string) {
  return screen.getByText(text).closest("[role='menuitem']");
}

describe("MapContextMenu", () => {
  it("BROWSE: shows directions, identify-road, send-vehicle and a create-incident submenu", () => {
    renderMenu();
    expect(screen.getByText("Find directions to here")).toBeInTheDocument();
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.getByText("Send selected vehicle here")).toBeInTheDocument();
    expect(screen.getByText("Create incident")).toBeInTheDocument();
  });

  it("BROWSE: send-vehicle is disabled without a selected vehicle, enabled with one", () => {
    const { unmount } = renderMenu({ hasSelectedVehicle: false });
    expect(itemFor("Send selected vehicle here")).toHaveAttribute("data-disabled");
    unmount();

    renderMenu({ hasSelectedVehicle: true });
    expect(itemFor("Send selected vehicle here")).not.toHaveAttribute("data-disabled");
  });

  it("SELECT: shows only identify-road", () => {
    renderMenu({ state: DispatchState.SELECT });
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find directions to here")).not.toBeInTheDocument();
    expect(screen.queryByText("Send selected vehicle here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
  });

  it("ROUTE with dispatch selection: add-waypoint is enabled", () => {
    renderMenu({ state: DispatchState.ROUTE, hasDispatchSelection: true });
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(itemFor("Add waypoint here")).not.toHaveAttribute("data-disabled");
  });

  it("ROUTE without dispatch selection: add-waypoint is shown but disabled", () => {
    renderMenu({ state: DispatchState.ROUTE, hasDispatchSelection: false });
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(itemFor("Add waypoint here")).toHaveAttribute("data-disabled");
  });

  it("DISPATCH: shows only identify-road", () => {
    renderMenu({ state: DispatchState.DISPATCH });
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find directions to here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
  });

  it("RESULTS: shows only identify-road", () => {
    renderMenu({ state: DispatchState.RESULTS });
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find directions to here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
  });
});

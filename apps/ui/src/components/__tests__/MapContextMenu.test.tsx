import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MapContextMenu from "../MapContextMenu";
import { DispatchState } from "@/hooks/useDispatchState";

function defaultProps(
  overrides: Partial<React.ComponentProps<typeof MapContextMenu>> = {},
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

describe("MapContextMenu", () => {
  it('BROWSE: shows "Find Directions To Here" and "Identify closest road"', () => {
    render(<MapContextMenu {...defaultProps()} />);
    expect(screen.getByText("Find Directions To Here")).toBeInTheDocument();
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
  });

  it('BROWSE with hasSelectedVehicle: also shows "Send selected vehicle here"', () => {
    render(<MapContextMenu {...defaultProps({ hasSelectedVehicle: true })} />);
    expect(screen.getByText("Find Directions To Here")).toBeInTheDocument();
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.getByText("Send selected vehicle here")).toBeInTheDocument();
  });

  it('SELECT: shows only "Identify closest road"', () => {
    render(<MapContextMenu {...defaultProps({ state: DispatchState.SELECT })} />);
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find Directions To Here")).not.toBeInTheDocument();
    expect(screen.queryByText("Send selected vehicle here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
  });

  it('ROUTE with hasDispatchSelection: shows "Add waypoint here" and "Identify closest road"', () => {
    render(
      <MapContextMenu
        {...defaultProps({ state: DispatchState.ROUTE, hasDispatchSelection: true })}
      />,
    );
    expect(screen.getByText("Add waypoint here")).toBeInTheDocument();
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
  });

  it('ROUTE without hasDispatchSelection: shows only "Identify closest road"', () => {
    render(
      <MapContextMenu
        {...defaultProps({ state: DispatchState.ROUTE, hasDispatchSelection: false })}
      />,
    );
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
  });

  it('DISPATCH: shows only "Identify closest road"', () => {
    render(<MapContextMenu {...defaultProps({ state: DispatchState.DISPATCH })} />);
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find Directions To Here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
    expect(screen.queryByText("Send selected vehicle here")).not.toBeInTheDocument();
  });

  it('RESULTS: shows only "Identify closest road"', () => {
    render(<MapContextMenu {...defaultProps({ state: DispatchState.RESULTS })} />);
    expect(screen.getByText("Identify closest road")).toBeInTheDocument();
    expect(screen.queryByText("Find Directions To Here")).not.toBeInTheDocument();
    expect(screen.queryByText("Add waypoint here")).not.toBeInTheDocument();
    expect(screen.queryByText("Send selected vehicle here")).not.toBeInTheDocument();
  });
});

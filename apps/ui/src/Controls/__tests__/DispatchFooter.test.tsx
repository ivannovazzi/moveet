import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DispatchFooter from "../DispatchFooter";
import { DispatchState } from "@/hooks/useDispatchState";
import type { DispatchAssignment, DirectionResult } from "@/types";

function defaultProps(
  overrides: Partial<React.ComponentProps<typeof DispatchFooter>> = {},
): React.ComponentProps<typeof DispatchFooter> {
  return {
    state: DispatchState.BROWSE,
    selectedCount: 0,
    assignments: [] as DispatchAssignment[],
    results: [] as DirectionResult[],
    onDispatch: vi.fn(),
    onClear: vi.fn(),
    onDone: vi.fn(),
    onRetryFailed: vi.fn(),
    dispatching: false,
    ...overrides,
  };
}

describe("DispatchFooter", () => {
  it("returns null for BROWSE state", () => {
    const { container } = render(<DispatchFooter {...defaultProps()} />);
    expect(container.innerHTML).toBe("");
  });

  it('shows "Select vehicles to dispatch" for SELECT with 0 selected', () => {
    render(<DispatchFooter {...defaultProps({ state: DispatchState.SELECT, selectedCount: 0 })} />);
    expect(screen.getByText("Select vehicles to dispatch")).toBeInTheDocument();
  });

  it('shows "3 selected" text for SELECT with selectedCount=3', () => {
    render(<DispatchFooter {...defaultProps({ state: DispatchState.SELECT, selectedCount: 3 })} />);
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
  });

  it("shows vehicle/stop counts for ROUTE state", () => {
    const assignments: DispatchAssignment[] = [
      {
        vehicleId: "v1",
        vehicleName: "Truck A",
        waypoints: [{ position: [-1.29, 36.82] }, { position: [-1.30, 36.83] }],
      },
      {
        vehicleId: "v2",
        vehicleName: "Truck B",
        waypoints: [{ position: [-1.31, 36.84] }],
      },
    ];
    render(
      <DispatchFooter {...defaultProps({ state: DispatchState.ROUTE, assignments })} />,
    );
    expect(screen.getByText("2 vehicles, 3 stops")).toBeInTheDocument();
  });

  it("shows Dispatch button (enabled) and Clear button for ROUTE", () => {
    const assignments: DispatchAssignment[] = [
      {
        vehicleId: "v1",
        vehicleName: "Truck A",
        waypoints: [{ position: [-1.29, 36.82] }],
      },
    ];
    render(
      <DispatchFooter {...defaultProps({ state: DispatchState.ROUTE, assignments })} />,
    );
    const dispatchBtn = screen.getByRole("button", { name: "Dispatch" });
    const clearBtn = screen.getByRole("button", { name: "Clear" });
    expect(dispatchBtn).toBeEnabled();
    expect(clearBtn).toBeInTheDocument();
  });

  it('shows "Dispatching..." with spinner for DISPATCH state', () => {
    render(
      <DispatchFooter
        {...defaultProps({ state: DispatchState.DISPATCH, dispatching: true })}
      />,
    );
    expect(screen.getByText(/Dispatching\.\.\./)).toBeInTheDocument();
  });

  it("shows success/failure counts for RESULTS state", () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "ok" },
      { vehicleId: "v3", status: "error", error: "no route" },
    ];
    render(<DispatchFooter {...defaultProps({ state: DispatchState.RESULTS, results })} />);
    expect(screen.getByText("2 dispatched, 1 failed")).toBeInTheDocument();
  });

  it('shows "Retry Failed" button when there are failures', () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "error", error: "no route" },
    ];
    render(<DispatchFooter {...defaultProps({ state: DispatchState.RESULTS, results })} />);
    expect(screen.getByRole("button", { name: "Retry Failed" })).toBeInTheDocument();
  });

  it('does not show "Retry Failed" when all succeeded', () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "ok" },
    ];
    render(<DispatchFooter {...defaultProps({ state: DispatchState.RESULTS, results })} />);
    expect(screen.queryByRole("button", { name: "Retry Failed" })).not.toBeInTheDocument();
    expect(screen.getByText("2 dispatched")).toBeInTheDocument();
  });

  it("calls onDispatch when Dispatch button clicked", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const assignments: DispatchAssignment[] = [
      {
        vehicleId: "v1",
        vehicleName: "Truck A",
        waypoints: [{ position: [-1.29, 36.82] }],
      },
    ];
    render(
      <DispatchFooter
        {...defaultProps({ state: DispatchState.ROUTE, assignments, onDispatch })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Dispatch" }));
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it("calls onClear when Clear/Exit button clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <DispatchFooter {...defaultProps({ state: DispatchState.SELECT, onClear })} />,
    );
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("calls onDone when Done button clicked", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const results: DirectionResult[] = [{ vehicleId: "v1", status: "ok" }];
    render(
      <DispatchFooter {...defaultProps({ state: DispatchState.RESULTS, results, onDone })} />,
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onRetryFailed when Retry Failed button clicked", async () => {
    const user = userEvent.setup();
    const onRetryFailed = vi.fn();
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "error", error: "no route" },
    ];
    render(
      <DispatchFooter
        {...defaultProps({ state: DispatchState.RESULTS, results, onRetryFailed })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Retry Failed" }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });
});

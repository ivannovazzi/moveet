import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DispatchFooter from "../DispatchFooter";
import { DispatchContext, type DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
import { createDispatchFlow } from "@/test/mocks/dispatchFlow";
import type { DispatchAssignment, DirectionResult } from "@/types";

// DispatchFooter reads the whole flow from DispatchContext.
function renderFooter(overrides: Partial<DispatchFlow> = {}) {
  const flow = createDispatchFlow(overrides);
  const result = render(
    <DispatchContext.Provider value={flow}>
      <DispatchFooter />
    </DispatchContext.Provider>
  );
  return { flow, ...result };
}

describe("DispatchFooter", () => {
  it("returns null for BROWSE state", () => {
    const { container } = renderFooter();
    expect(container.innerHTML).toBe("");
  });

  it('shows "Select vehicles to dispatch" for SELECT with 0 selected', () => {
    renderFooter({ dispatchState: DispatchState.SELECT });
    expect(screen.getByText("Select vehicles to dispatch")).toBeInTheDocument();
  });

  it('shows "3 selected" text for SELECT with three selected vehicles', () => {
    renderFooter({
      dispatchState: DispatchState.SELECT,
      selectedForDispatch: ["v1", "v2", "v3"],
    });
    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
  });

  it("shows vehicle/stop counts for ROUTE state", () => {
    const assignments: DispatchAssignment[] = [
      {
        vehicleId: "v1",
        vehicleName: "Truck A",
        waypoints: [{ position: [-1.29, 36.82] }, { position: [-1.3, 36.83] }],
      },
      {
        vehicleId: "v2",
        vehicleName: "Truck B",
        waypoints: [{ position: [-1.31, 36.84] }],
      },
    ];
    renderFooter({ dispatchState: DispatchState.ROUTE, assignments });
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
    renderFooter({ dispatchState: DispatchState.ROUTE, assignments });
    const dispatchBtn = screen.getByRole("button", { name: "Dispatch" });
    const clearBtn = screen.getByRole("button", { name: "Clear" });
    expect(dispatchBtn).toBeEnabled();
    expect(clearBtn).toBeInTheDocument();
  });

  it('shows "Dispatching..." with spinner for DISPATCH state', () => {
    renderFooter({ dispatchState: DispatchState.DISPATCH, dispatching: true });
    expect(screen.getByText(/Dispatching\.\.\./)).toBeInTheDocument();
  });

  it("shows success/failure counts for RESULTS state", () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "ok" },
      { vehicleId: "v3", status: "error", error: "no route" },
    ];
    renderFooter({ dispatchState: DispatchState.RESULTS, results });
    expect(screen.getByText("2 dispatched, 1 failed")).toBeInTheDocument();
  });

  it('shows "Retry Failed" button when there are failures', () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "error", error: "no route" },
    ];
    renderFooter({ dispatchState: DispatchState.RESULTS, results });
    expect(screen.getByRole("button", { name: "Retry Failed" })).toBeInTheDocument();
  });

  it('does not show "Retry Failed" when all succeeded', () => {
    const results: DirectionResult[] = [
      { vehicleId: "v1", status: "ok" },
      { vehicleId: "v2", status: "ok" },
    ];
    renderFooter({ dispatchState: DispatchState.RESULTS, results });
    expect(screen.queryByRole("button", { name: "Retry Failed" })).not.toBeInTheDocument();
    expect(screen.getByText("2 dispatched")).toBeInTheDocument();
  });

  it("calls handleDispatch when Dispatch button clicked", async () => {
    const user = userEvent.setup();
    const handleDispatch = vi.fn().mockResolvedValue(undefined);
    const assignments: DispatchAssignment[] = [
      {
        vehicleId: "v1",
        vehicleName: "Truck A",
        waypoints: [{ position: [-1.29, 36.82] }],
      },
    ];
    renderFooter({ dispatchState: DispatchState.ROUTE, assignments, handleDispatch });
    await user.click(screen.getByRole("button", { name: "Dispatch" }));
    expect(handleDispatch).toHaveBeenCalledTimes(1);
  });

  it("calls handleDone when the Exit button clicked in SELECT", async () => {
    const user = userEvent.setup();
    const handleDone = vi.fn();
    renderFooter({ dispatchState: DispatchState.SELECT, handleDone });
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(handleDone).toHaveBeenCalledTimes(1);
  });

  it("calls handleDone when Done button clicked in RESULTS", async () => {
    const user = userEvent.setup();
    const handleDone = vi.fn();
    const results: DirectionResult[] = [{ vehicleId: "v1", status: "ok" }];
    renderFooter({ dispatchState: DispatchState.RESULTS, results, handleDone });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(handleDone).toHaveBeenCalledTimes(1);
  });

  it("calls handleRetryFailed when Retry Failed button clicked", async () => {
    const user = userEvent.setup();
    const handleRetryFailed = vi.fn();
    const results: DirectionResult[] = [{ vehicleId: "v1", status: "error", error: "no route" }];
    renderFooter({ dispatchState: DispatchState.RESULTS, results, handleRetryFailed });
    await user.click(screen.getByRole("button", { name: "Retry Failed" }));
    expect(handleRetryFailed).toHaveBeenCalledTimes(1);
  });
});

import { vi } from "vitest";
import { DispatchState } from "@/hooks/useDispatchState";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";

/** A pristine (browse-mode) DispatchFlow for providing DispatchContext in tests. */
export function createDispatchFlow(overrides: Partial<DispatchFlow> = {}): DispatchFlow {
  return {
    dispatchMode: false,
    assignments: [],
    dispatching: false,
    results: [],
    selectedForDispatch: [],
    dispatchState: DispatchState.BROWSE,
    error: null,
    toggleDispatchMode: vi.fn(),
    handleDispatch: vi.fn().mockResolvedValue(undefined),
    handleDone: vi.fn(),
    handleRetryFailed: vi.fn(),
    onToggleVehicleForDispatch: vi.fn(),
    onAddWaypoint: vi.fn(),
    addWaypointForSelected: vi.fn(),
    moveWaypointGroup: vi.fn(),
    removeWaypointGroup: vi.fn(),
    setAssignments: vi.fn(),
    ...overrides,
  };
}

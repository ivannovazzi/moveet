import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDispatchFlow } from "./useDispatchFlow";
import { DispatchState } from "./useDispatchState";
import type { Vehicle } from "@/types";
import { createVehicle } from "@/test/mocks/types";

vi.mock("@/utils/client", () => ({
  default: {
    batchDirection: vi.fn(),
  },
}));

import client from "@/utils/client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDispatchFlow", () => {
  it("initializes in BROWSE state with empty collections", () => {
    const { result } = renderHook(() => useDispatchFlow());

    expect(result.current.dispatchMode).toBe(false);
    expect(result.current.assignments).toEqual([]);
    expect(result.current.dispatching).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.selectedForDispatch).toEqual([]);
    expect(result.current.dispatchState).toBe(DispatchState.BROWSE);
  });

  it("toggleDispatchMode enters SELECT state", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
    });

    expect(result.current.dispatchMode).toBe(true);
    expect(result.current.dispatchState).toBe(DispatchState.SELECT);
  });

  it("toggleDispatchMode off clears all dispatch state", () => {
    const { result } = renderHook(() => useDispatchFlow());

    // Enter dispatch mode and build up some state
    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
    });

    expect(result.current.selectedForDispatch).toEqual(["v1"]);

    // Exit dispatch mode
    act(() => {
      result.current.toggleDispatchMode();
    });

    expect(result.current.dispatchMode).toBe(false);
    expect(result.current.selectedForDispatch).toEqual([]);
    expect(result.current.assignments).toEqual([]);
    expect(result.current.results).toEqual([]);
    expect(result.current.dispatching).toBe(false);
  });

  it("onToggleVehicleForDispatch adds and removes vehicle IDs", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
    });

    expect(result.current.selectedForDispatch).toEqual(["v1"]);

    act(() => {
      result.current.onToggleVehicleForDispatch("v2");
    });

    expect(result.current.selectedForDispatch).toEqual(["v1", "v2"]);

    // Toggle v1 off
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
    });

    expect(result.current.selectedForDispatch).toEqual(["v2"]);
  });

  it("transitions to ROUTE state when vehicles are selected", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
    });

    expect(result.current.dispatchState).toBe(DispatchState.ROUTE);
  });

  it("onAddWaypoint appends a waypoint to an existing assignment", () => {
    const { result } = renderHook(() => useDispatchFlow());

    // Set up an initial assignment
    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
      ]);
    });

    // Position is [lng, lat] from map, toLatLng converts to [lat, lng]
    act(() => {
      result.current.onAddWaypoint("v1", [36.83, -1.3]);
    });

    expect(result.current.assignments[0].waypoints).toHaveLength(2);
    expect(result.current.assignments[0].waypoints[1].position).toEqual([-1.3, 36.83]);
  });

  it("onAddWaypoint does not modify assignments for other vehicles", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
        { vehicleId: "v2", vehicleName: "Van", waypoints: [{ position: [-1.28, 36.81] }] },
      ]);
    });

    act(() => {
      result.current.onAddWaypoint("v1", [36.83, -1.3]);
    });

    expect(result.current.assignments[0].waypoints).toHaveLength(2);
    expect(result.current.assignments[1].waypoints).toHaveLength(1);
  });

  it("addWaypointForSelected creates assignments for new vehicles and appends to existing", () => {
    const { result } = renderHook(() => useDispatchFlow());
    const vehicles: Vehicle[] = [
      createVehicle({ id: "v1", name: "Alpha" }),
      createVehicle({ id: "v2", name: "Beta" }),
    ];

    // Select both vehicles
    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
      result.current.onToggleVehicleForDispatch("v2");
    });

    // Give v1 an existing assignment
    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Alpha", waypoints: [{ position: [-1.29, 36.82] }] },
      ]);
    });

    // Add waypoint for selected (both v1 and v2)
    act(() => {
      result.current.addWaypointForSelected([36.83, -1.3], vehicles);
    });

    expect(result.current.assignments).toHaveLength(2);
    // v1 should have 2 waypoints (existing + new)
    const v1Assignment = result.current.assignments.find((a) => a.vehicleId === "v1");
    expect(v1Assignment?.waypoints).toHaveLength(2);
    // v2 should have 1 waypoint (newly created)
    const v2Assignment = result.current.assignments.find((a) => a.vehicleId === "v2");
    expect(v2Assignment?.waypoints).toHaveLength(1);
    expect(v2Assignment?.vehicleName).toBe("Beta");
  });

  it("moveWaypointGroup updates positions for the referenced waypoints only", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
      result.current.setAssignments([
        {
          vehicleId: "v1",
          vehicleName: "Alpha",
          waypoints: [{ position: [-1.29, 36.82] }, { position: [-1.3, 36.83] }],
        },
        {
          vehicleId: "v2",
          vehicleName: "Beta",
          waypoints: [{ position: [-1.29, 36.82] }],
        },
      ]);
    });

    // Move the shared first waypoint on both vehicles to a new location.
    act(() => {
      result.current.moveWaypointGroup(
        [
          { vehicleId: "v1", waypointIndex: 0 },
          { vehicleId: "v2", waypointIndex: 0 },
        ],
        -1.4,
        36.9
      );
    });

    const v1 = result.current.assignments.find((a) => a.vehicleId === "v1")!;
    const v2 = result.current.assignments.find((a) => a.vehicleId === "v2")!;
    expect(v1.waypoints[0].position).toEqual([-1.4, 36.9]);
    expect(v1.waypoints[1].position).toEqual([-1.3, 36.83]); // untouched
    expect(v2.waypoints[0].position).toEqual([-1.4, 36.9]);
  });

  it("removeWaypointGroup drops the referenced waypoints and empty assignments", () => {
    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
      result.current.setAssignments([
        {
          vehicleId: "v1",
          vehicleName: "Alpha",
          waypoints: [{ position: [-1.29, 36.82] }, { position: [-1.3, 36.83] }],
        },
        {
          vehicleId: "v2",
          vehicleName: "Beta",
          waypoints: [{ position: [-1.29, 36.82] }],
        },
      ]);
    });

    act(() => {
      result.current.removeWaypointGroup([
        { vehicleId: "v1", waypointIndex: 0 },
        { vehicleId: "v2", waypointIndex: 0 },
      ]);
    });

    // v1 keeps its second waypoint; v2's assignment is dropped entirely.
    expect(result.current.assignments).toHaveLength(1);
    const v1 = result.current.assignments[0];
    expect(v1.vehicleId).toBe("v1");
    expect(v1.waypoints).toHaveLength(1);
    expect(v1.waypoints[0].position).toEqual([-1.3, 36.83]);
  });

  it("handleDispatch sends batch direction request and stores results", async () => {
    const mockResults = [{ vehicleId: "v1", status: "ok" as const }];
    vi.mocked(client.batchDirection).mockResolvedValue({
      data: { status: "ok", results: mockResults },
    });

    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
      ]);
    });

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(client.batchDirection).toHaveBeenCalledWith([{ id: "v1", lat: -1.29, lng: 36.82 }]);
    expect(result.current.results).toEqual(mockResults);
    expect(result.current.dispatching).toBe(false);
    expect(result.current.dispatchState).toBe(DispatchState.RESULTS);
  });

  it("handleDispatch does nothing when assignments are empty", async () => {
    const { result } = renderHook(() => useDispatchFlow());

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(client.batchDirection).not.toHaveBeenCalled();
  });

  it("handleDispatch handles errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(client.batchDirection).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
      ]);
    });

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(result.current.dispatching).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith("Dispatch failed:", expect.any(Error));
    consoleSpy.mockRestore();
  });

  it("handleDone resets all dispatch state", () => {
    const { result } = renderHook(() => useDispatchFlow());

    // Build up state
    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.onToggleVehicleForDispatch("v1");
    });
    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
      ]);
    });

    act(() => {
      result.current.handleDone();
    });

    expect(result.current.dispatchMode).toBe(false);
    expect(result.current.selectedForDispatch).toEqual([]);
    expect(result.current.assignments).toEqual([]);
    expect(result.current.results).toEqual([]);
    expect(result.current.dispatching).toBe(false);
    expect(result.current.dispatchState).toBe(DispatchState.BROWSE);
  });

  it("handleRetryFailed selects only vehicles with error results", async () => {
    vi.mocked(client.batchDirection).mockResolvedValue({
      data: {
        status: "partial",
        results: [
          { vehicleId: "v1", status: "ok" as const },
          { vehicleId: "v2", status: "error" as const, error: "No route" },
        ],
      },
    });

    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.toggleDispatchMode();
    });
    act(() => {
      result.current.setAssignments([
        { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
        { vehicleId: "v2", vehicleName: "Van", waypoints: [{ position: [-1.28, 36.81] }] },
      ]);
    });

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(result.current.results).toHaveLength(2);

    act(() => {
      result.current.handleRetryFailed();
    });

    expect(result.current.selectedForDispatch).toEqual(["v2"]);
    expect(result.current.assignments).toHaveLength(1);
    expect(result.current.assignments[0].vehicleId).toBe("v2");
    expect(result.current.results).toEqual([]);
  });

  it("handleDispatch includes waypoints when there are multiple", async () => {
    vi.mocked(client.batchDirection).mockResolvedValue({
      data: { status: "ok", results: [{ vehicleId: "v1", status: "ok" as const }] },
    });

    const { result } = renderHook(() => useDispatchFlow());

    act(() => {
      result.current.setAssignments([
        {
          vehicleId: "v1",
          vehicleName: "Truck",
          waypoints: [
            { position: [-1.29, 36.82], label: "Stop A" },
            { position: [-1.3, 36.83], dwellTime: 60 },
          ],
        },
      ]);
    });

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(client.batchDirection).toHaveBeenCalledWith([
      {
        id: "v1",
        lat: -1.3,
        lng: 36.83,
        waypoints: [
          { lat: -1.29, lng: 36.82, label: "Stop A" },
          { lat: -1.3, lng: 36.83, dwellTime: 60 },
        ],
      },
    ]);
  });
});

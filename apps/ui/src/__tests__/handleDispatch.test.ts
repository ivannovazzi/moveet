import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCallback, useState } from "react";
import type { DirectionResult, DispatchAssignment } from "@/types";

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------
const batchDirectionMock = vi.fn();

vi.mock("@/utils/client", () => ({
  default: {
    batchDirection: (...args: unknown[]) => batchDirectionMock(...args),
    onVehicle: vi.fn(),
    offVehicle: vi.fn(),
    connectWebSocket: vi.fn(),
    disconnect: vi.fn(),
  },
}));

import client from "@/utils/client";

// ---------------------------------------------------------------------------
// Extract the handleDispatch logic into a testable hook that mirrors App.tsx
// ---------------------------------------------------------------------------
function useDispatch(assignments: DispatchAssignment[]) {
  const [dispatching, setDispatching] = useState(false);
  const [results, setResults] = useState<DirectionResult[]>([]);

  const handleDispatch = useCallback(async () => {
    if (assignments.length === 0) return;
    setDispatching(true);
    setResults([]);

    const body = assignments.map((a) => {
      const dest = a.waypoints[a.waypoints.length - 1];
      return {
        id: a.vehicleId,
        lat: dest.position[0],
        lng: dest.position[1],
      };
    });

    try {
      const response = await client.batchDirection(body);
      if (response.data?.results) {
        setResults(response.data.results);
      }
    } catch (error) {
      console.error("Dispatch failed:", error);
    } finally {
      setDispatching(false);
    }
  }, [assignments]);

  return { dispatching, results, handleDispatch };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  batchDirectionMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleDispatch error handling", () => {
  const assignments: DispatchAssignment[] = [
    {
      vehicleId: "v1",
      vehicleName: "Truck A",
      waypoints: [{ position: [-1.29, 36.82] }],
    },
  ];

  it("sets dispatching=false after successful dispatch", async () => {
    batchDirectionMock.mockResolvedValue({
      data: { results: [{ vehicleId: "v1", status: "ok" }] },
    });

    const { result } = renderHook(() => useDispatch(assignments));

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(result.current.dispatching).toBe(false);
    expect(result.current.results).toEqual([{ vehicleId: "v1", status: "ok" }]);
  });

  it("sets dispatching=false when network request throws", async () => {
    batchDirectionMock.mockRejectedValue(new Error("Network error"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useDispatch(assignments));

    await act(async () => {
      await result.current.handleDispatch();
    });

    // Critical: dispatching must be reset even on error
    expect(result.current.dispatching).toBe(false);
    // Results should remain empty on error
    expect(result.current.results).toEqual([]);
    // Error should be logged
    expect(consoleSpy).toHaveBeenCalledWith("Dispatch failed:", expect.any(Error));

    consoleSpy.mockRestore();
  });

  it("does not dispatch when assignments are empty", async () => {
    const { result } = renderHook(() => useDispatch([]));

    await act(async () => {
      await result.current.handleDispatch();
    });

    expect(batchDirectionMock).not.toHaveBeenCalled();
    expect(result.current.dispatching).toBe(false);
  });

  it("sets dispatching=true during the async operation", async () => {
    let resolvePromise: (value: unknown) => void;
    batchDirectionMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { result } = renderHook(() => useDispatch(assignments));

    // Start dispatch but don't await yet
    let dispatchPromise: Promise<void>;
    act(() => {
      dispatchPromise = result.current.handleDispatch();
    });

    // During the async operation, dispatching should be true
    expect(result.current.dispatching).toBe(true);

    // Resolve and complete
    await act(async () => {
      resolvePromise!({ data: { results: [] } });
      await dispatchPromise!;
    });

    expect(result.current.dispatching).toBe(false);
  });
});

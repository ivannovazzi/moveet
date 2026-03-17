import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React, { useState } from "react";
import { useDirections } from "./useDirections";
import type { DirectionMap } from "@/data/context";
import { DirectionContext } from "@/data/context";
import type { Route, VehicleDirection } from "@/types";
import client from "@/utils/client";

vi.mock("@/utils/client", () => ({
  default: {
    getDirections: vi.fn(),
    onDirection: vi.fn(),
    onConnect: vi.fn(),
    onReset: vi.fn(),
    onWaypointReached: vi.fn(),
    onRouteCompleted: vi.fn(),
  },
}));

function createRoute(overrides: Partial<Route> = {}): Route {
  return {
    edges: [],
    distance: 100,
    ...overrides,
  };
}

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const [directions, setDirections] = useState<DirectionMap>(new Map());
    return React.createElement(
      DirectionContext.Provider,
      {
        value: {
          directions,
          setDirections,
        },
      },
      children
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getDirections).mockResolvedValue({ data: undefined });
  vi.mocked(client.onDirection).mockImplementation(() => {});
});

describe("useDirections", () => {
  it("returns initial empty directions map", () => {
    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
  });

  it("fetches directions on mount and populates the map", async () => {
    const route1 = createRoute({ distance: 200 });
    const route2 = createRoute({ distance: 350 });
    const directions: VehicleDirection[] = [
      { vehicleId: "v1", route: route1, eta: 60 },
      { vehicleId: "v2", route: route2, eta: 120 },
    ];

    vi.mocked(client.getDirections).mockResolvedValue({ data: directions });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    // Wait for the promise to resolve and state to update
    await act(async () => {
      await vi.mocked(client.getDirections).mock.results[0].value;
    });

    expect(client.getDirections).toHaveBeenCalledOnce();
    expect(result.current.size).toBe(2);
    expect(result.current.get("v1")?.route).toBe(route1);
    expect(result.current.get("v2")?.route).toBe(route2);
  });

  it("handles WS direction updates via onDirection callback", async () => {
    vi.mocked(client.getDirections).mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    // Wait for initial fetch
    await act(async () => {
      await vi.mocked(client.getDirections).mock.results[0].value;
    });

    // Grab the onDirection handler that the hook registered
    const onDirectionMock = vi.mocked(client.onDirection);
    expect(onDirectionMock).toHaveBeenCalledOnce();
    const handler = onDirectionMock.mock.calls[0][0];

    const wsRoute = createRoute({ distance: 500 });

    act(() => {
      handler({ vehicleId: "ws-v1", route: wsRoute, eta: 45 });
    });

    expect(result.current.size).toBe(1);
    expect(result.current.get("ws-v1")?.route).toBe(wsRoute);

    // Verify a second WS update adds to the map without removing the first
    const wsRoute2 = createRoute({ distance: 750 });

    act(() => {
      handler({ vehicleId: "ws-v2", route: wsRoute2, eta: 90 });
    });

    expect(result.current.size).toBe(2);
    expect(result.current.get("ws-v1")?.route).toBe(wsRoute);
    expect(result.current.get("ws-v2")?.route).toBe(wsRoute2);
  });

  it("handles getDirections returning no data gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(client.getDirections).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.mocked(client.getDirections).mock.results[0].value;
    });

    expect(result.current.size).toBe(0);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("handles waypoint:reached by updating currentWaypointIndex", async () => {
    const route = createRoute({ distance: 300 });
    vi.mocked(client.getDirections).mockResolvedValue({
      data: [
        {
          vehicleId: "v1",
          route,
          eta: 60,
          waypoints: [{ position: [-1.29, 36.82] }, { position: [-1.3, 36.83] }],
          currentWaypointIndex: 0,
        },
      ],
    });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.mocked(client.getDirections).mock.results[0].value;
    });

    expect(result.current.get("v1")?.currentWaypointIndex).toBe(0);

    // Grab the onWaypointReached handler that the hook registered
    const onWaypointReachedMock = vi.mocked(client.onWaypointReached);
    expect(onWaypointReachedMock).toHaveBeenCalledOnce();
    const handler = onWaypointReachedMock.mock.calls[0][0];

    act(() => {
      handler({ vehicleId: "v1", waypointIndex: 1 });
    });

    expect(result.current.get("v1")?.currentWaypointIndex).toBe(1);
  });

  it("handles route:completed by removing the direction", async () => {
    const route = createRoute({ distance: 200 });
    vi.mocked(client.getDirections).mockResolvedValue({
      data: [{ vehicleId: "v1", route, eta: 45 }],
    });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.mocked(client.getDirections).mock.results[0].value;
    });

    expect(result.current.size).toBe(1);
    expect(result.current.has("v1")).toBe(true);

    // Grab the onRouteCompleted handler that the hook registered
    const onRouteCompletedMock = vi.mocked(client.onRouteCompleted);
    expect(onRouteCompletedMock).toHaveBeenCalledOnce();
    const handler = onRouteCompletedMock.mock.calls[0][0];

    act(() => {
      handler({ vehicleId: "v1" });
    });

    expect(result.current.size).toBe(0);
    expect(result.current.has("v1")).toBe(false);
  });
});

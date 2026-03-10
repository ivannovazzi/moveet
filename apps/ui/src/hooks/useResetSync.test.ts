import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React, { useState } from "react";
import { useVehicles } from "./useVehicles";
import { useDirections } from "./useDirections";
import { createVehicleDTO } from "@/test/mocks/types";
import type { DirectionMap } from "@/data/context";
import { ClientDataContext } from "@/data/context";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import type { VehicleDTO, VehicleDirection, Route } from "@/types";
import type { ResetPayload } from "@/utils/wsTypes";
import client from "@/utils/client";

// --- Mocks ---

type ConnectHandler = () => void;
type ResetHandler = (data: ResetPayload) => void;
type DirectionHandler = (direction: VehicleDirection) => void;

let connectHandlers: ConnectHandler[] = [];
let resetHandlers: ResetHandler[] = [];
let directionHandlers: DirectionHandler[] = [];

vi.mock("@/utils/client", () => ({
  default: {
    onVehicle: vi.fn(),
    onConnect: vi.fn((h: ConnectHandler) => {
      connectHandlers.push(h);
    }),
    onReset: vi.fn((h: ResetHandler) => {
      resetHandlers.push(h);
    }),
    onDirection: vi.fn((h: DirectionHandler) => {
      directionHandlers.push(h);
    }),
    getVehicles: vi.fn().mockResolvedValue({ data: [] }),
    getDirections: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

// --- rAF stubbing (needed by useVehicleChanges) ---

let pendingRafCallbacks: FrameRequestCallback[] = [];
let rafCounter = 0;

vi.stubGlobal(
  "requestAnimationFrame",
  vi.fn((cb: FrameRequestCallback) => {
    pendingRafCallbacks.push(cb);
    return ++rafCounter;
  })
);
vi.stubGlobal("cancelAnimationFrame", vi.fn());

function flushRaf() {
  const cbs = pendingRafCallbacks;
  pendingRafCallbacks = [];
  cbs.forEach((cb) => cb(0));
}

// --- Context wrapper for useDirections ---

function createDirectionsWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const [directions, setDirections] = useState<DirectionMap>(new Map());
    return React.createElement(
      ClientDataContext.Provider,
      {
        value: {
          options: DEFAULT_START_OPTIONS,
          roads: [],
          pois: [],
          directions,
          heatzones: [],
          network: { type: "FeatureCollection" as const, features: [] },
          setOptions: () => {},
          setRoads: () => {},
          setPOIs: () => {},
          setDirections,
          setHeatzones: () => {},
          setNetwork: () => {},
        },
      },
      children
    );
  };
}

// --- Helpers ---

function createRoute(overrides: Partial<Route> = {}): Route {
  return {
    edges: [],
    distance: 100,
    ...overrides,
  };
}

function simulateAppResetHandler(setVehicles: (vehicles: VehicleDTO[]) => void) {
  // Mirrors what App.tsx sets up in its useEffect
  client.onReset((data: ResetPayload) => {
    setVehicles(data.vehicles);
  });
}

function simulateAppConnectHandler(setVehicles: (vehicles: VehicleDTO[]) => void) {
  // Mirrors what App.tsx sets up in its useEffect
  client.onConnect(() => {
    client.getVehicles().then((response) => {
      if (response.data) setVehicles(response.data);
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingRafCallbacks = [];
  rafCounter = 0;
  connectHandlers = [];
  resetHandlers = [];
  directionHandlers = [];
});

// --- Tests ---

describe("reset WS event: full vehicle replacement", () => {
  it("replaces all vehicles on reset, removing stale IDs", () => {
    const { result } = renderHook(() => useVehicles());

    // Wire up handlers the same way App.tsx does
    simulateAppResetHandler(result.current.setVehicles);

    // Seed with initial vehicles
    const v1 = createVehicleDTO({ id: "v1", name: "Alpha" });
    const v2 = createVehicleDTO({ id: "v2", name: "Beta" });
    act(() => {
      result.current.setVehicles([v1, v2]);
    });
    expect(result.current.vehicles).toHaveLength(2);

    // Also add a vehicle via WS delta (simulating normal operation)
    const vehicleHandler = vi.mocked(client.onVehicle).mock.calls[0][0];
    const v3 = createVehicleDTO({ id: "v3", name: "Gamma" });
    act(() => {
      vehicleHandler(v3);
      flushRaf();
    });
    expect(result.current.vehicles).toHaveLength(3);

    // Fire the reset event with only v1 -- v2 and v3 should disappear
    const resetV1 = createVehicleDTO({ id: "v1", name: "Alpha Updated", speed: 99 });
    act(() => {
      resetHandlers.forEach((h) => h({ vehicles: [resetV1], directions: [] }));
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("v1");
    expect(result.current.vehicles[0].name).toBe("Alpha Updated");
    expect(result.current.vehicles[0].speed).toBe(99);
  });

  it("clears all vehicles when reset payload is empty", () => {
    const { result } = renderHook(() => useVehicles());
    simulateAppResetHandler(result.current.setVehicles);

    const v1 = createVehicleDTO({ id: "v1", name: "Alpha" });
    act(() => {
      result.current.setVehicles([v1]);
    });
    expect(result.current.vehicles).toHaveLength(1);

    act(() => {
      resetHandlers.forEach((h) => h({ vehicles: [], directions: [] }));
    });

    expect(result.current.vehicles).toHaveLength(0);
  });
});

describe("reconnect: re-fetch vehicles from REST", () => {
  it("re-fetches vehicles on reconnect, replacing stale state", async () => {
    const { result } = renderHook(() => useVehicles());
    simulateAppConnectHandler(result.current.setVehicles);

    // Seed with stale data
    const stale = createVehicleDTO({ id: "stale-1", name: "Stale" });
    act(() => {
      result.current.setVehicles([stale]);
    });
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("stale-1");

    // Set up REST response for reconnect
    const freshVehicles = [createVehicleDTO({ id: "fresh-1", name: "Fresh" })];
    vi.mocked(client.getVehicles).mockResolvedValue({ data: freshVehicles });

    // Fire the connect event
    await act(async () => {
      connectHandlers.forEach((h) => h());
    });

    expect(client.getVehicles).toHaveBeenCalled();
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].id).toBe("fresh-1");
    expect(result.current.vehicles[0].name).toBe("Fresh");
  });
});

describe("reset WS event: full directions replacement", () => {
  it("replaces directions map on reset (not merge)", async () => {
    const { result } = renderHook(() => useDirections(), {
      wrapper: createDirectionsWrapper(),
    });

    // Wait for initial fetch
    await act(async () => {});

    // Add a direction via delta
    const staleRoute = createRoute({ distance: 100 });
    act(() => {
      directionHandlers.forEach((h) => h({ vehicleId: "stale-dir", route: staleRoute, eta: 0 }));
    });
    expect(result.current.get("stale-dir")).toBeDefined();

    // Fire reset with a different set of directions -- stale-dir should disappear
    const resetDirections: VehicleDirection[] = [
      { vehicleId: "new-dir", route: createRoute({ distance: 200 }), eta: 0 },
    ];
    act(() => {
      resetHandlers.forEach((h) => h({ vehicles: [], directions: resetDirections }));
    });

    expect(result.current.get("stale-dir")).toBeUndefined();
    expect(result.current.get("new-dir")).toBeDefined();
    expect(result.current.get("new-dir")!.distance).toBe(200);
  });
});

describe("reconnect: re-fetch directions from REST", () => {
  it("re-fetches directions on connect", async () => {
    const route = createRoute({ distance: 300 });
    vi.mocked(client.getDirections).mockResolvedValue({
      data: [{ vehicleId: "reconnected-dir", route, eta: 0 }],
    });

    const { result } = renderHook(() => useDirections(), {
      wrapper: createDirectionsWrapper(),
    });

    // Wait for initial fetch
    await act(async () => {});
    expect(result.current.get("reconnected-dir")).toBeDefined();

    // Update the mock to return different data for reconnect
    const reconnectRoute = createRoute({ distance: 999 });
    vi.mocked(client.getDirections).mockResolvedValue({
      data: [{ vehicleId: "reconnect-v", route: reconnectRoute, eta: 0 }],
    });

    // Fire connect event
    await act(async () => {
      connectHandlers.forEach((h) => h());
    });

    // getDirections called at least twice: once on mount, once on reconnect
    expect(vi.mocked(client.getDirections).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.get("reconnect-v")).toBeDefined();
    expect(result.current.get("reconnect-v")!.distance).toBe(999);
  });
});

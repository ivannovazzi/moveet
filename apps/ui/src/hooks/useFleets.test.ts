import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFleets } from "./useFleets";
import client from "@/utils/client";
import type { Fleet } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getFleets: vi.fn(),
    createFleet: vi.fn(),
    deleteFleet: vi.fn(),
    assignVehicles: vi.fn(),
    unassignVehicles: vi.fn(),
    onFleetCreated: vi.fn(),
    onFleetDeleted: vi.fn(),
    onFleetAssigned: vi.fn(),
    offFleetCreated: vi.fn(),
    offFleetDeleted: vi.fn(),
    offFleetAssigned: vi.fn(),
    subscribe: vi.fn(),
  },
}));

function createFleet(overrides: Partial<Fleet> = {}): Fleet {
  return {
    id: "fleet-1",
    name: "Alpha Fleet",
    color: "#ff0000",
    source: "local",
    vehicleIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getFleets).mockResolvedValue({ data: undefined });
  vi.mocked(client.createFleet).mockResolvedValue({ data: undefined });
  vi.mocked(client.deleteFleet).mockResolvedValue({ data: undefined });
  vi.mocked(client.assignVehicles).mockResolvedValue({ data: undefined });
  vi.mocked(client.unassignVehicles).mockResolvedValue({ data: undefined });
  vi.mocked(client.onFleetCreated).mockImplementation(() => {});
  vi.mocked(client.onFleetDeleted).mockImplementation(() => {});
  vi.mocked(client.onFleetAssigned).mockImplementation(() => {});
});

describe("useFleets", () => {
  it("initializes with empty fleets and empty hiddenFleetIds", () => {
    const { result } = renderHook(() => useFleets());

    expect(result.current.fleets).toEqual([]);
    expect(result.current.hiddenFleetIds).toEqual(new Set());
  });

  it("fetches fleets on mount and populates state", async () => {
    const fleet1 = createFleet({ id: "f1", name: "Fleet A" });
    const fleet2 = createFleet({ id: "f2", name: "Fleet B" });

    vi.mocked(client.getFleets).mockResolvedValue({ data: [fleet1, fleet2] });

    const { result } = renderHook(() => useFleets());

    await vi.waitFor(() => {
      expect(result.current.fleets).toHaveLength(2);
    });

    expect(result.current.fleets).toEqual([fleet1, fleet2]);
  });

  it("handles fetch returning no data gracefully", async () => {
    vi.mocked(client.getFleets).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useFleets());

    await vi.waitFor(() => {
      expect(client.getFleets).toHaveBeenCalledOnce();
    });

    expect(result.current.fleets).toEqual([]);
  });

  // --- WS events ---

  it("adds fleet via WS onFleetCreated", () => {
    const { result } = renderHook(() => useFleets());

    const handler = vi.mocked(client.onFleetCreated).mock.calls[0][0];
    const newFleet = createFleet({ id: "ws-f1", name: "WS Fleet" });

    act(() => {
      handler(newFleet);
    });

    expect(result.current.fleets).toHaveLength(1);
    expect(result.current.fleets[0].id).toBe("ws-f1");
  });

  it("removes fleet via WS onFleetDeleted", async () => {
    const fleet1 = createFleet({ id: "f1" });
    const fleet2 = createFleet({ id: "f2" });

    vi.mocked(client.getFleets).mockResolvedValue({ data: [fleet1, fleet2] });

    const { result } = renderHook(() => useFleets());

    await vi.waitFor(() => {
      expect(result.current.fleets).toHaveLength(2);
    });

    const handler = vi.mocked(client.onFleetDeleted).mock.calls[0][0];

    act(() => {
      handler({ id: "f1" });
    });

    expect(result.current.fleets).toHaveLength(1);
    expect(result.current.fleets[0].id).toBe("f2");
  });

  it("onFleetDeleted also removes fleet from hiddenFleetIds", async () => {
    const fleet1 = createFleet({ id: "f1" });
    vi.mocked(client.getFleets).mockResolvedValue({ data: [fleet1] });

    const { result } = renderHook(() => useFleets());

    await vi.waitFor(() => {
      expect(result.current.fleets).toHaveLength(1);
    });

    // Hide the fleet first
    act(() => {
      result.current.toggleFleetVisibility("f1");
    });
    expect(result.current.hiddenFleetIds.has("f1")).toBe(true);

    // Delete it via WS
    const handler = vi.mocked(client.onFleetDeleted).mock.calls[0][0];
    act(() => {
      handler({ id: "f1" });
    });

    expect(result.current.fleets).toHaveLength(0);
    expect(result.current.hiddenFleetIds.has("f1")).toBe(false);
  });

  it("assigns vehicles to a fleet via WS onFleetAssigned", async () => {
    const fleet1 = createFleet({ id: "f1", vehicleIds: ["v1"] });
    const fleet2 = createFleet({ id: "f2", vehicleIds: ["v2"] });

    vi.mocked(client.getFleets).mockResolvedValue({ data: [fleet1, fleet2] });

    const { result } = renderHook(() => useFleets());

    await vi.waitFor(() => {
      expect(result.current.fleets).toHaveLength(2);
    });

    const handler = vi.mocked(client.onFleetAssigned).mock.calls[0][0];

    // Move v2 from fleet2 to fleet1
    act(() => {
      handler({ fleetId: "f1", vehicleIds: ["v2"] });
    });

    const f1 = result.current.fleets.find((f) => f.id === "f1")!;
    const f2 = result.current.fleets.find((f) => f.id === "f2")!;

    expect(f1.vehicleIds).toContain("v1");
    expect(f1.vehicleIds).toContain("v2");
    expect(f2.vehicleIds).not.toContain("v2");
  });

  // --- Action callbacks ---

  it("createFleet calls client.createFleet", async () => {
    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.createFleet("New Fleet");
    });

    expect(client.createFleet).toHaveBeenCalledWith("New Fleet");
  });

  it("deleteFleet calls client.deleteFleet", async () => {
    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.deleteFleet("f1");
    });

    expect(client.deleteFleet).toHaveBeenCalledWith("f1");
  });

  it("assignVehicle calls client.assignVehicles with array", async () => {
    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.assignVehicle("f1", "v1");
    });

    expect(client.assignVehicles).toHaveBeenCalledWith("f1", ["v1"]);
  });

  it("unassignVehicle calls client.unassignVehicles with array", async () => {
    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.unassignVehicle("f1", "v1");
    });

    expect(client.unassignVehicles).toHaveBeenCalledWith("f1", ["v1"]);
  });

  // --- Visibility toggling ---

  it("toggleFleetVisibility adds and removes fleet ids", () => {
    const { result } = renderHook(() => useFleets());

    act(() => {
      result.current.toggleFleetVisibility("f1");
    });
    expect(result.current.hiddenFleetIds.has("f1")).toBe(true);

    act(() => {
      result.current.toggleFleetVisibility("f1");
    });
    expect(result.current.hiddenFleetIds.has("f1")).toBe(false);
  });

  it("toggleFleetVisibility works with multiple fleets independently", () => {
    const { result } = renderHook(() => useFleets());

    act(() => {
      result.current.toggleFleetVisibility("f1");
      result.current.toggleFleetVisibility("f2");
    });

    expect(result.current.hiddenFleetIds.has("f1")).toBe(true);
    expect(result.current.hiddenFleetIds.has("f2")).toBe(true);

    act(() => {
      result.current.toggleFleetVisibility("f1");
    });

    expect(result.current.hiddenFleetIds.has("f1")).toBe(false);
    expect(result.current.hiddenFleetIds.has("f2")).toBe(true);
  });
});

describe("useFleets error handling", () => {
  it("createFleet sets error on API error response", async () => {
    vi.mocked(client.createFleet).mockResolvedValue({ error: "Fleet name taken" });

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.createFleet("Duplicate Fleet");
    });

    expect(result.current.error).toBe("Fleet name taken");
  });

  it("createFleet sets error on network exception", async () => {
    vi.mocked(client.createFleet).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.createFleet("New Fleet");
    });

    expect(result.current.error).toBe("Network error");
  });

  it("deleteFleet sets error on failure", async () => {
    vi.mocked(client.deleteFleet).mockResolvedValue({ error: "Fleet not found" });

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.deleteFleet("nonexistent");
    });

    expect(result.current.error).toBe("Fleet not found");
  });

  it("assignVehicle sets error on failure", async () => {
    vi.mocked(client.assignVehicles).mockResolvedValue({ error: "Vehicle already assigned" });

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.assignVehicle("f1", "v1");
    });

    expect(result.current.error).toBe("Vehicle already assigned");
  });

  it("unassignVehicle sets error on failure", async () => {
    vi.mocked(client.unassignVehicles).mockResolvedValue({ error: "Vehicle not in fleet" });

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.unassignVehicle("f1", "v1");
    });

    expect(result.current.error).toBe("Vehicle not in fleet");
  });

  it("error clears on next successful operation", async () => {
    vi.mocked(client.createFleet).mockResolvedValue({ error: "Some error" });

    const { result } = renderHook(() => useFleets());

    await act(async () => {
      await result.current.createFleet("Fail");
    });
    expect(result.current.error).toBe("Some error");

    vi.mocked(client.createFleet).mockResolvedValue({ data: undefined });

    await act(async () => {
      await result.current.createFleet("Success");
    });
    expect(result.current.error).toBeNull();
  });
});

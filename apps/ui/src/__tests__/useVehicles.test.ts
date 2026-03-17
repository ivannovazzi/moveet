import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { VehicleDTO } from "@/types";
import { vehicleDTOChanged } from "@/hooks/useVehicles";
import { vehicleStore } from "@/hooks/vehicleStore";

// ---------------------------------------------------------------------------
// Mock the client module so the WebSocket listener can be driven manually
// ---------------------------------------------------------------------------
let vehicleHandler: ((v: VehicleDTO) => void) | undefined;
const offVehicleMock = vi.fn();

vi.mock("@/utils/client", () => ({
  default: {
    onVehicle: (handler: (v: VehicleDTO) => void) => {
      vehicleHandler = handler;
    },
    offVehicle: (...args: unknown[]) => offVehicleMock(...args),
    connectWebSocket: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// Import AFTER mock registration so the module picks up the mock
import { useVehicles } from "@/hooks/useVehicles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDTO(overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id: "v1",
    name: "Vehicle 1",
    position: [36.82, -1.29],
    speed: 30,
    heading: 90,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vehicleHandler = undefined;
  offVehicleMock.mockClear();
  vehicleStore.replace([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advance the throttle interval so React state syncs from the store. */
function flushStore() {
  vi.advanceTimersByTime(1100);
}

// ---------------------------------------------------------------------------
// vehicleDTOChanged (pure function)
// ---------------------------------------------------------------------------
describe("vehicleDTOChanged", () => {
  it("returns false for identical DTOs", () => {
    const a = makeDTO();
    expect(vehicleDTOChanged(a, { ...a })).toBe(false);
  });

  it("detects position change", () => {
    const a = makeDTO();
    const b = makeDTO({ position: [36.83, -1.29] });
    expect(vehicleDTOChanged(a, b)).toBe(true);
  });

  it("detects heading change", () => {
    const a = makeDTO();
    const b = makeDTO({ heading: 180 });
    expect(vehicleDTOChanged(a, b)).toBe(true);
  });

  it("detects speed change", () => {
    const a = makeDTO();
    const b = makeDTO({ speed: 60 });
    expect(vehicleDTOChanged(a, b)).toBe(true);
  });

  it("detects name change", () => {
    const a = makeDTO();
    const b = makeDTO({ name: "Renamed" });
    expect(vehicleDTOChanged(a, b)).toBe(true);
  });

  it("detects fleetId change", () => {
    const a = makeDTO();
    const b = makeDTO({ fleetId: "fleet-1" });
    expect(vehicleDTOChanged(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useVehicles — throttled React state from vehicleStore
// ---------------------------------------------------------------------------
describe("useVehicles — store-backed state", () => {
  it("WS updates flow through vehicleStore to React after throttle", () => {
    const { result } = renderHook(() => useVehicles());

    const v1 = makeDTO({ id: "v1" });
    const v2 = makeDTO({ id: "v2", name: "Vehicle 2" });

    act(() => {
      vehicleHandler!(v1);
      vehicleHandler!(v2);
      flushStore();
    });

    expect(result.current.vehicles).toHaveLength(2);
  });

  it("deduplicates by id — last update wins after throttle", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      vehicleHandler!(makeDTO({ id: "v1", speed: 10 }));
      vehicleHandler!(makeDTO({ id: "v1", speed: 99 }));
      flushStore();
    });

    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.vehicles[0].speed).toBe(99);
  });

  it("selection changes are immediate (no throttle needed)", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      result.current.setVehicles([makeDTO({ id: "v1" }), makeDTO({ id: "v2", name: "V2" })]);
    });

    act(() => {
      result.current.onSelectVehicle("v1");
    });

    expect(result.current.vehicles.find((v) => v.id === "v1")!.selected).toBe(true);
    expect(result.current.vehicles.find((v) => v.id === "v2")!.selected).toBe(false);
  });

  it("hover changes are immediate", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      result.current.setVehicles([makeDTO({ id: "v1" }), makeDTO({ id: "v2", name: "V2" })]);
    });

    act(() => {
      result.current.onHoverVehicle("v2");
    });

    expect(result.current.vehicles.find((v) => v.id === "v2")!.hovered).toBe(true);
    expect(result.current.vehicles.find((v) => v.id === "v1")!.hovered).toBe(false);
  });

  it("text filter changes recompute visibility correctly", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      result.current.setVehicles([
        makeDTO({ id: "v1", name: "Alpha" }),
        makeDTO({ id: "v2", name: "Beta" }),
      ]);
    });

    expect(result.current.vehicles.every((v) => v.visible)).toBe(true);

    act(() => {
      result.current.onFilterChange("alpha");
    });

    expect(result.current.vehicles.find((v) => v.id === "v1")!.visible).toBe(true);
    expect(result.current.vehicles.find((v) => v.id === "v2")!.visible).toBe(false);
  });

  it("calls offVehicle on unmount to remove WS handler", () => {
    const { unmount } = renderHook(() => useVehicles());

    expect(offVehicleMock).not.toHaveBeenCalled();

    unmount();

    expect(offVehicleMock).toHaveBeenCalledTimes(1);
  });
});

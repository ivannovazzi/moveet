import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { VehicleDTO } from "@/types";
import { vehicleDTOChanged } from "@/hooks/useVehicles";

// ---------------------------------------------------------------------------
// Mock the client module so the WebSocket listener can be driven manually
// ---------------------------------------------------------------------------
let vehicleHandler: ((v: VehicleDTO) => void) | undefined;

vi.mock("@/utils/client", () => ({
  default: {
    onVehicle: (handler: (v: VehicleDTO) => void) => {
      vehicleHandler = handler;
    },
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

// We need to control requestAnimationFrame so flush happens synchronously.
let rafCallbacks: Array<FrameRequestCallback> = [];

function flushRAF() {
  const cbs = rafCallbacks.splice(0);
  for (const cb of cbs) cb(performance.now());
}

beforeEach(() => {
  vehicleHandler = undefined;
  rafCallbacks = [];

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
// useVehicles — reference stability
// ---------------------------------------------------------------------------
describe("useVehicles — reference stability", () => {
  it("unchanged vehicles keep the same object reference after a new tick", () => {
    const { result } = renderHook(() => useVehicles());

    const v1 = makeDTO({ id: "v1" });
    const v2 = makeDTO({ id: "v2", name: "Vehicle 2" });

    // Initial push
    act(() => {
      vehicleHandler!(v1);
      vehicleHandler!(v2);
      flushRAF();
    });

    const first = result.current.vehicles;
    expect(first).toHaveLength(2);

    // Only v1 moves; v2 stays the same
    act(() => {
      vehicleHandler!(makeDTO({ id: "v1", position: [36.83, -1.30] }));
      flushRAF();
    });

    const second = result.current.vehicles;
    expect(second).toHaveLength(2);

    const v1After = second.find((v) => v.id === "v1")!;
    const v2After = second.find((v) => v.id === "v2")!;
    const v1Before = first.find((v) => v.id === "v1")!;
    const v2Before = first.find((v) => v.id === "v2")!;

    // v1 changed — must be a new object
    expect(v1After).not.toBe(v1Before);
    // v2 unchanged — must be the exact same object reference
    expect(v2After).toBe(v2Before);
  });

  it("skips setState when no vehicles actually changed", () => {
    const { result } = renderHook(() => useVehicles());

    const v1 = makeDTO({ id: "v1" });

    act(() => {
      vehicleHandler!(v1);
      flushRAF();
    });

    const first = result.current.vehicles;

    // Push the same DTO again (same field values)
    act(() => {
      vehicleHandler!(makeDTO({ id: "v1" }));
      flushRAF();
    });

    // The array reference should be the same because flush detected no changes
    // and skipped setState. The mapped vehicles useMemo will also not re-run
    // because its dependency (vehicles array) didn't change.
    const second = result.current.vehicles;
    expect(second).toBe(first);
  });

  it("only vehicles affected by filter changes get new references", () => {
    const { result } = renderHook(() => useVehicles());

    const v1 = makeDTO({ id: "v1" });
    const v2 = makeDTO({ id: "v2", name: "Vehicle 2" });

    act(() => {
      vehicleHandler!(v1);
      vehicleHandler!(v2);
      flushRAF();
    });

    const first = result.current.vehicles;
    const v1Before = first.find((v) => v.id === "v1")!;
    const v2Before = first.find((v) => v.id === "v2")!;

    // Select v1
    act(() => {
      result.current.onSelectVehicle("v1");
    });

    const second = result.current.vehicles;
    const v1After = second.find((v) => v.id === "v1")!;
    const v2After = second.find((v) => v.id === "v2")!;

    // v1 selected state changed — new reference
    expect(v1After.selected).toBe(true);
    expect(v1After).not.toBe(v1Before);

    // v2 unchanged — same reference
    expect(v2After.selected).toBe(false);
    expect(v2After).toBe(v2Before);
  });

  it("hover changes only affect the hovered vehicle reference", () => {
    const { result } = renderHook(() => useVehicles());

    const v1 = makeDTO({ id: "v1" });
    const v2 = makeDTO({ id: "v2", name: "Vehicle 2" });

    act(() => {
      vehicleHandler!(v1);
      vehicleHandler!(v2);
      flushRAF();
    });

    const first = result.current.vehicles;
    const v1Before = first.find((v) => v.id === "v1")!;
    const v2Before = first.find((v) => v.id === "v2")!;

    act(() => {
      result.current.onHoverVehicle("v2");
    });

    const second = result.current.vehicles;
    const v1After = second.find((v) => v.id === "v1")!;
    const v2After = second.find((v) => v.id === "v2")!;

    expect(v2After.hovered).toBe(true);
    expect(v2After).not.toBe(v2Before);
    expect(v1After).toBe(v1Before);
  });

  it("text filter changes recompute visibility correctly", () => {
    const { result } = renderHook(() => useVehicles());

    act(() => {
      vehicleHandler!(makeDTO({ id: "v1", name: "Alpha" }));
      vehicleHandler!(makeDTO({ id: "v2", name: "Beta" }));
      flushRAF();
    });

    expect(result.current.vehicles.every((v) => v.visible)).toBe(true);

    act(() => {
      result.current.onFilterChange("alpha");
    });

    const filtered = result.current.vehicles;
    expect(filtered.find((v) => v.id === "v1")!.visible).toBe(true);
    expect(filtered.find((v) => v.id === "v2")!.visible).toBe(false);
  });
});

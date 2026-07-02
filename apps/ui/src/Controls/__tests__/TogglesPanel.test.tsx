import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Modifiers, VehicleType } from "@/types";
import { createModifiers } from "@/test/mocks/types";
import { createMemoryLocalStorage } from "@/test/mocks/localStorage";

// ---------------------------------------------------------------------------
// Mock vehicleStore for trail capacity calls
// ---------------------------------------------------------------------------
vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    setTrailCapacity: vi.fn(),
    getTrail: vi.fn(() => []),
    clearTrails: vi.fn(),
  },
}));

import TogglesPanel from "../TogglesPanel";
import { vehicleStore } from "@/hooks/vehicleStore";

beforeEach(() => {
  // The Node test runtime's localStorage global throws on access — give the
  // panel (and assertions) a working in-memory implementation.
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultModifiers(overrides: Partial<Modifiers> = {}): Modifiers {
  return {
    ...createModifiers(),
    showTrafficOverlay: true,
    showBreadcrumbs: false,
    ...overrides,
  } as Modifiers;
}

function renderPanel(
  modifiers: Modifiers,
  onChangeModifiers?: ReturnType<typeof vi.fn>,
  options: {
    hiddenVehicleTypes?: Set<VehicleType>;
    onToggleVehicleType?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const changeFn = onChangeModifiers ?? vi.fn(() => vi.fn());
  const { hiddenVehicleTypes = new Set<VehicleType>(), onToggleVehicleType = vi.fn() } = options;
  return render(
    <TogglesPanel
      modifiers={modifiers}
      onChangeModifiers={changeFn}
      hiddenVehicleTypes={hiddenVehicleTypes}
      onToggleVehicleType={onToggleVehicleType}
    />
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TogglesPanel", () => {
  it("renders all toggle switches including Trails", () => {
    renderPanel(defaultModifiers());

    // Existing toggles
    expect(screen.getByLabelText("Network")).toBeInTheDocument();
    expect(screen.getByLabelText("Traffic Colours")).toBeInTheDocument();
    expect(screen.getByLabelText("Vehicles")).toBeInTheDocument();
    expect(screen.getByLabelText("Heatmap")).toBeInTheDocument();
    expect(screen.getByLabelText("Zones")).toBeInTheDocument();
    expect(screen.getByLabelText("POIs")).toBeInTheDocument();

    // New Trails toggle
    expect(screen.getByLabelText("Trails")).toBeInTheDocument();
  });

  it("trail length slider appears when showBreadcrumbs is true", () => {
    renderPanel(defaultModifiers({ showBreadcrumbs: true } as Partial<Modifiers>));

    // When trails are enabled, a trail length slider should be visible
    expect(screen.getByRole("slider", { name: /trail length/i })).toBeInTheDocument();
  });

  it("trail length slider is hidden when showBreadcrumbs is false", () => {
    renderPanel(defaultModifiers({ showBreadcrumbs: false } as Partial<Modifiers>));

    // When trails are disabled, no trail length slider should be present
    expect(screen.queryByRole("slider", { name: /trail length/i })).not.toBeInTheDocument();
  });

  it("debounces trail-length commits to the vehicle store", () => {
    vi.useFakeTimers();
    renderPanel(defaultModifiers({ showBreadcrumbs: true } as Partial<Modifiers>));

    // The mount initializer applies the stored capacity once — ignore it.
    vi.mocked(vehicleStore.setTrailCapacity).mockClear();

    const slider = screen.getByRole("slider", { name: /trail length/i });
    fireEvent.keyDown(slider, { key: "ArrowRight" }); // 60 → 70

    // Store mutation must not happen synchronously while dragging
    expect(vehicleStore.setTrailCapacity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(vehicleStore.setTrailCapacity).toHaveBeenCalledTimes(1);
    expect(vehicleStore.setTrailCapacity).toHaveBeenCalledWith(70);
    expect(localStorage.getItem("trailLength")).toBe("70");
  });

  it("flushes a pending trail-length change on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderPanel(
      defaultModifiers({ showBreadcrumbs: true } as Partial<Modifiers>)
    );

    vi.mocked(vehicleStore.setTrailCapacity).mockClear();

    const slider = screen.getByRole("slider", { name: /trail length/i });
    fireEvent.keyDown(slider, { key: "ArrowRight" }); // 60 → 70

    unmount();

    expect(vehicleStore.setTrailCapacity).toHaveBeenCalledTimes(1);
    expect(vehicleStore.setTrailCapacity).toHaveBeenCalledWith(70);
  });

  it("renders a Vehicle Types section with all 5 types", () => {
    renderPanel(defaultModifiers());

    expect(screen.getByText("Vehicle Types")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle Car visibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle Truck visibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle Moto visibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle Ambulance visibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle Bus visibility")).toBeInTheDocument();
  });

  it("calls onToggleVehicleType with the right type when a switch is clicked", async () => {
    const user = userEvent.setup();
    const onToggleVehicleType = vi.fn();
    renderPanel(defaultModifiers(), undefined, { onToggleVehicleType });

    await user.click(screen.getByLabelText("Toggle Truck visibility"));

    expect(onToggleVehicleType).toHaveBeenCalledWith("truck");
  });

  it("reflects hiddenVehicleTypes in the switch state", () => {
    renderPanel(defaultModifiers(), undefined, {
      hiddenVehicleTypes: new Set<VehicleType>(["bus"]),
    });

    expect(screen.getByLabelText("Toggle Bus visibility")).not.toBeChecked();
    expect(screen.getByLabelText("Toggle Car visibility")).toBeChecked();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Modifiers } from "@/types";
import { createModifiers } from "@/test/mocks/types";
import { createMemoryLocalStorage } from "@/test/mocks/localStorage";

// The trail-length control writes through to the store; jsdom has no vehicles.
vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    setTrailCapacity: vi.fn(),
    getTrail: vi.fn(() => []),
    clearTrails: vi.fn(),
  },
}));

import VisibilityRail from "./VisibilityRail";
import { VISIBILITY_LAYERS } from "./visibilityLayers";
import { vehicleStore } from "@/hooks/vehicleStore";

beforeEach(() => {
  // The Node test runtime's localStorage global throws on access.
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderRail(overrides: Partial<Modifiers> = {}, onChange = vi.fn(() => vi.fn())) {
  const result = render(
    <VisibilityRail
      modifiers={{ ...createModifiers(), ...overrides } as Modifiers}
      onChangeModifiers={onChange}
      hiddenVehicleTypes={new Set()}
      onToggleVehicleType={vi.fn()}
    />
  );
  return { ...result, onChange };
}

const key = (label: string) => screen.getByRole("button", { name: label });

describe("VisibilityRail", () => {
  it("renders one icon key per layer, and nothing else", () => {
    renderRail();

    for (const { label } of VISIBILITY_LAYERS) {
      expect(key(label)).toBeInTheDocument();
    }
    // Icons only: no label text, and no switch widgets left over from the panel.
    expect(screen.getByRole("group", { name: "Layer visibility" })).toHaveTextContent("");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("covers the layers the old panel did, including Density and Jobs", () => {
    const labels = VISIBILITY_LAYERS.map((l) => l.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Network",
        "Traffic Colours",
        "Vehicles",
        "Density",
        "Jobs",
        "Trails",
        "Heatmap",
        "Zones",
        "POIs",
        "Speed Limits",
      ])
    );
  });

  it("carries the vehicle-type filters as a key seated under Vehicles", () => {
    renderRail();

    const keys = screen
      .getByRole("group", { name: "Layer visibility" })
      .querySelectorAll(":scope > * > button, :scope > button");
    const names = Array.from(keys).map((el) => el.getAttribute("aria-label"));

    expect(names).toContain("Vehicle types");
    expect(names.indexOf("Vehicle types")).toBe(names.indexOf("Vehicles") + 1);
  });

  it("reports state as aria-pressed on the key", () => {
    renderRail({ showVehicles: true, showPOIs: false });

    expect(key("Vehicles")).toHaveAttribute("aria-pressed", "true");
    expect(key("POIs")).toHaveAttribute("aria-pressed", "false");
  });

  it("reads an absent optional modifier as off", () => {
    renderRail({ showDensity: undefined, showJobs: undefined });

    expect(key("Density")).toHaveAttribute("aria-pressed", "false");
    expect(key("Jobs")).toHaveAttribute("aria-pressed", "false");
  });

  it("routes a press through onChangeModifiers(key) with the flipped value", () => {
    const setter = vi.fn();
    const onChange = vi.fn(() => setter);
    renderRail({ showDensity: undefined }, onChange);

    fireEvent.click(key("Density"));

    expect(onChange).toHaveBeenCalledWith("showDensity");
    expect(setter).toHaveBeenCalledWith(true);
  });

  it("turns a lit layer back off", () => {
    const setter = vi.fn();
    const onChange = vi.fn(() => setter);
    renderRail({ showHeatmap: true }, onChange);

    fireEvent.click(key("Heatmap"));

    expect(onChange).toHaveBeenCalledWith("showHeatmap");
    expect(setter).toHaveBeenCalledWith(false);
  });

  describe("trail length", () => {
    it("offers no trail-length control while Trails is off", () => {
      renderRail({ showBreadcrumbs: false });

      expect(screen.queryByRole("button", { name: "Trail length" })).not.toBeInTheDocument();
      expect(screen.queryByRole("slider", { name: /trail length/i })).not.toBeInTheDocument();
    });

    it("shows the length chip while Trails is on, slider only once opened", () => {
      renderRail({ showBreadcrumbs: true });

      const chip = screen.getByRole("button", { name: "Trail length" });
      expect(chip).toHaveTextContent("60");
      expect(screen.queryByRole("slider", { name: /trail length/i })).not.toBeInTheDocument();

      fireEvent.click(chip);

      expect(screen.getByRole("slider", { name: /trail length/i })).toBeInTheDocument();
      expect(chip).toHaveAttribute("aria-expanded", "true");
    });

    it("closes the popover when Trails is switched off", () => {
      const { rerender } = renderRail({ showBreadcrumbs: true });
      fireEvent.click(screen.getByRole("button", { name: "Trail length" }));
      expect(screen.getByRole("slider", { name: /trail length/i })).toBeInTheDocument();

      rerender(
        <VisibilityRail
          modifiers={{ ...createModifiers(), showBreadcrumbs: false } as Modifiers}
          onChangeModifiers={vi.fn(() => vi.fn())}
          hiddenVehicleTypes={new Set()}
          onToggleVehicleType={vi.fn()}
        />
      );

      expect(screen.queryByRole("slider", { name: /trail length/i })).not.toBeInTheDocument();
    });

    it("debounces trail-length commits to the vehicle store", () => {
      vi.useFakeTimers();
      renderRail({ showBreadcrumbs: true });
      fireEvent.click(screen.getByRole("button", { name: "Trail length" }));

      // The mount initializer applies the stored capacity once — ignore it.
      vi.mocked(vehicleStore.setTrailCapacity).mockClear();

      const slider = screen.getByRole("slider", { name: /trail length/i });
      fireEvent.keyDown(slider, { key: "ArrowRight" }); // 60 → 70

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
      const { unmount } = renderRail({ showBreadcrumbs: true });
      fireEvent.click(screen.getByRole("button", { name: "Trail length" }));

      vi.mocked(vehicleStore.setTrailCapacity).mockClear();

      fireEvent.keyDown(screen.getByRole("slider", { name: /trail length/i }), {
        key: "ArrowRight",
      });

      unmount();

      expect(vehicleStore.setTrailCapacity).toHaveBeenCalledTimes(1);
      expect(vehicleStore.setTrailCapacity).toHaveBeenCalledWith(70);
    });
  });
});

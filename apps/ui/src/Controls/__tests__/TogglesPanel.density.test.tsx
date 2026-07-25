import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Modifiers } from "@/types";
import { createModifiers } from "@/test/mocks/types";
import { createMemoryLocalStorage } from "@/test/mocks/localStorage";

vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    setTrailCapacity: vi.fn(),
    getTrail: vi.fn(() => []),
    clearTrails: vi.fn(),
  },
}));

import TogglesPanel from "../TogglesPanel";

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel(modifiers: Partial<Modifiers>, onChange = vi.fn(() => vi.fn())) {
  render(
    <TogglesPanel
      modifiers={{ ...createModifiers(), ...modifiers } as Modifiers}
      onChangeModifiers={onChange}
    />
  );
  return onChange;
}

describe("TogglesPanel — Density", () => {
  it("exposes Density through the same visibility-toggle list", () => {
    renderPanel({});
    expect(screen.getByLabelText("Density")).toBeInTheDocument();
  });

  it("reads as off when showDensity is absent (optional modifier)", () => {
    renderPanel({});
    expect(screen.getByLabelText("Density")).not.toBeChecked();
  });

  it("reads as on when showDensity is true", () => {
    renderPanel({ showDensity: true });
    expect(screen.getByLabelText("Density")).toBeChecked();
  });

  it("routes changes through onChangeModifiers('showDensity')", () => {
    const setter = vi.fn();
    const onChange = vi.fn(() => setter);
    renderPanel({}, onChange);

    fireEvent.click(screen.getByLabelText("Density"));

    expect(onChange).toHaveBeenCalledWith("showDensity");
    expect(setter).toHaveBeenCalledWith(true);
  });

  it("leaves the other toggles untouched", () => {
    renderPanel({});
    for (const label of ["Network", "Vehicles", "Heatmap", "Zones", "POIs", "Trails"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Modifiers } from "@/types";
import { createModifiers } from "@/test/mocks/types";

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

function renderPanel(modifiers: Modifiers, onChangeModifiers?: ReturnType<typeof vi.fn>) {
  const changeFn = onChangeModifiers ?? vi.fn(() => vi.fn());
  return render(<TogglesPanel modifiers={modifiers} onChangeModifiers={changeFn} />);
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
});

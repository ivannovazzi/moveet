import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { VehicleDTO } from "@/types";
import { vehicleStore } from "../../hooks/vehicleStore";

// ---------------------------------------------------------------------------
// Capture registered layers via useRegisterLayers mock (same pattern as
// Direction.test.tsx — the real hook requires the DeckLayersContext provider,
// which isn't mounted in this unit test).
// ---------------------------------------------------------------------------
const { registeredLayers } = vi.hoisted(() => {
  const registeredLayers = new Map<string, unknown[]>();
  return { registeredLayers };
});

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

// useMapContext's default context value already returns degenerate bounds
// ([[0,0],[0,0]]) and zoom 0, which disables viewport culling in the RAF loop
// (see VehiclesLayer's `cullEnabled` check) — no mock needed for this test.

import VehiclesLayer, { computeIconAlpha } from "./VehiclesLayer";

function makeVehicle(id: string, overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id,
    name: id,
    type: "car",
    position: [1.0, 36.8],
    speed: 40,
    heading: 0,
    ...overrides,
  };
}

function getLayer(id: string) {
  const layers = (registeredLayers.get("vehicles") ?? []) as { id: string; props: unknown }[];
  return layers.find((l) => l.id === id);
}

async function waitForRaf() {
  // The RAF loop throttles publishes and needs at least one animation frame
  // to run through the initial `positionsChanged` branch and publish state.
  // Wrapped in act() since the loop triggers a React state update (setVehicleData).
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

describe("VehiclesLayer selection dimming", () => {
  beforeEach(() => {
    registeredLayers.clear();
    vehicleStore.replace([]);
  });

  it("reduces icon alpha for non-selected vehicles when selectedId is set", async () => {
    vehicleStore.replace([makeVehicle("v1", { speed: 40 }), makeVehicle("v2", { speed: 40 })]);

    render(
      <VehiclesLayer
        scale={1}
        vehicleFleetMap={new Map()}
        hiddenFleetIds={new Set()}
        hiddenVehicleTypes={new Set()}
        selectedId="v1"
        onClick={vi.fn()}
      />
    );

    await waitForRaf();

    const vehiclesLayer = getLayer("vehicles");
    expect(vehiclesLayer).toBeTruthy();
    const data = vehiclesLayer!.props as { data: { id: string; iconColor: number[] }[] };
    const selected = data.data.find((d) => d.id === "v1");
    const other = data.data.find((d) => d.id === "v2");
    expect(selected).toBeTruthy();
    expect(other).toBeTruthy();
    expect(other!.iconColor[3]).toBeLessThan(selected!.iconColor[3]);
  });

  it("does not dim any vehicle when no selection is active", async () => {
    vehicleStore.replace([makeVehicle("v1", { speed: 40 }), makeVehicle("v2", { speed: 40 })]);

    render(
      <VehiclesLayer
        scale={1}
        vehicleFleetMap={new Map()}
        hiddenFleetIds={new Set()}
        hiddenVehicleTypes={new Set()}
        onClick={vi.fn()}
      />
    );

    await waitForRaf();

    const vehiclesLayer = getLayer("vehicles");
    const data = vehiclesLayer!.props as { data: { id: string; iconColor: number[] }[] };
    const v1 = data.data.find((d) => d.id === "v1");
    const v2 = data.data.find((d) => d.id === "v2");
    expect(v1!.iconColor[3]).toBe(v2!.iconColor[3]);
  });
});

describe("computeIconAlpha", () => {
  it("returns full moving alpha when no vehicle is selected", () => {
    expect(computeIconAlpha(40, "v1", undefined)).toBe(255);
  });

  it("returns full idle alpha for the selected vehicle even if idle", () => {
    expect(computeIconAlpha(0, "v1", "v1")).toBe(166);
  });

  it("dims a non-selected moving vehicle to half alpha", () => {
    expect(computeIconAlpha(40, "v2", "v1")).toBe(Math.round(255 * 0.5));
  });

  it("dims a non-selected idle vehicle to half of the idle alpha", () => {
    expect(computeIconAlpha(0, "v2", "v1")).toBe(Math.round(166 * 0.5));
  });

  it("does not dim the selected vehicle itself", () => {
    expect(computeIconAlpha(40, "v1", "v1")).toBe(255);
  });
});

/**
 * Sprite picking vs. modal point-picking.
 *
 * A vehicle pick returns `true` from the IconLayer's `onClick`, which stops
 * DeckGL from firing its map-level `onClick`. That is what makes "click a
 * vehicle to select it" not also clear the selection — but it also means a
 * point-picking mode (placing a job's pickup) would silently lose any click
 * landing on a sprite. `selectable={false}` is the release valve, and these
 * tests hold both halves of that contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { VehicleDTO } from "@moveet/shared-types";
import type { Fleet, VehicleType } from "@/types";

const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));
vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    getZoom: () => 14,
    // Degenerate bounds → culling disabled, so every seeded vehicle is kept.
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
  }),
}));

const { state } = vi.hoisted(() => ({
  state: { store: new Map<string, VehicleDTO>(), version: 0 },
}));
vi.mock("@/hooks/vehicleStore", () => ({
  vehicleStore: {
    getAll: () => state.store,
    getVersion: () => state.version,
  },
}));

import VehiclesLayer from "./VehiclesLayer";

let rafQueue: FrameRequestCallback[] = [];
let clock = 1000;

function pumpFrames(count = 3) {
  for (let i = 0; i < count; i++) {
    const queued = rafQueue;
    rafQueue = [];
    clock += 100;
    act(() => {
      for (const cb of queued) cb(clock);
    });
  }
}

function seedVehicle(id = "v1") {
  state.store.clear();
  state.store.set(id, {
    id,
    name: `Unit ${id}`,
    type: "car" as VehicleType,
    position: [-1.28, 36.82],
    speed: 30,
    heading: 90,
  } as unknown as VehicleDTO);
  state.version++;
}

type LayerLike = { id: string; props: Record<string, unknown> };

function iconLayer(): LayerLike | undefined {
  const layers = (registeredLayers.get("vehicles") ?? []) as LayerLike[];
  return layers.find((l) => l.id === "vehicles");
}

function clickSprite() {
  const layer = iconLayer();
  const onClick = layer?.props.onClick as (info: { object?: { id: string } }) => unknown;
  return onClick({ object: { id: "v1" } });
}

function renderLayer(selectable?: boolean) {
  const onClick = vi.fn();
  render(
    <VehiclesLayer
      scale={1.5}
      vehicleFleetMap={new Map<string, Fleet>()}
      hiddenFleetIds={new Set<string>()}
      hiddenVehicleTypes={new Set<VehicleType>()}
      onClick={onClick}
      selectable={selectable}
    />
  );
  return onClick;
}

beforeEach(() => {
  registeredLayers.clear();
  state.store.clear();
  state.version = 0;
  rafQueue = [];
  clock = 1000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VehiclesLayer sprite selection", () => {
  it("selects the vehicle and claims the click by default", () => {
    seedVehicle();
    const onClick = renderLayer();
    pumpFrames();

    expect(clickSprite()).toBe(true);
    expect(onClick).toHaveBeenCalledWith("v1");
  });

  it("still claims the click when selectable is passed explicitly true", () => {
    seedVehicle();
    const onClick = renderLayer(true);
    pumpFrames();

    expect(clickSprite()).toBe(true);
    expect(onClick).toHaveBeenCalledWith("v1");
  });

  it("neither selects nor claims the click when not selectable", () => {
    seedVehicle();
    const onClick = renderLayer(false);
    pumpFrames();

    // false lets DeckGL fall through to its map-level onClick, so the point
    // still reaches whichever mode is picking coordinates.
    expect(clickSprite()).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("never claims a click that hit no sprite", () => {
    seedVehicle();
    const onClick = renderLayer();
    pumpFrames();

    const layer = iconLayer();
    const handler = layer?.props.onClick as (info: { object?: { id: string } }) => unknown;
    expect(handler({})).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

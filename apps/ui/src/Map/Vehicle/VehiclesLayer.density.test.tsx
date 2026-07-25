/**
 * Density-mode interaction with the vehicle hot path.
 *
 * Drives the RAF loop by hand (jsdom has no compositor) and asserts on the
 * constructed layer props — the IconLayer's `data`, not pixels.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { VehicleDTO } from "@moveet/shared-types";
import type { Fleet, VehicleType } from "@/types";

// ── Capture registered layers ──────────────────────────────────────
const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));
vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

// ── Mock viewport ──────────────────────────────────────────────────
const { ctx } = vi.hoisted(() => ({ ctx: { zoom: 11 } }));
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    getZoom: () => ctx.zoom,
    // Degenerate bounds → viewport culling disabled, so every vehicle is kept.
    getBoundingBox: () => [
      [0, 0],
      [0, 0],
    ],
  }),
}));

// ── Mock the vehicle store ─────────────────────────────────────────
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
import { DENSITY_MIN_VEHICLES, DENSITY_ZOOM_THRESHOLD } from "./densityView";

// ── RAF driver ─────────────────────────────────────────────────────
let rafQueue: FrameRequestCallback[] = [];
let clock = 1000;

function pumpFrames(count = 3) {
  for (let i = 0; i < count; i++) {
    const queued = rafQueue;
    rafQueue = [];
    clock += 100; // comfortably past the ~60fps publish gate
    act(() => {
      for (const cb of queued) cb(clock);
    });
  }
}

function seedVehicles(count: number, offset = 0) {
  state.store.clear();
  for (let i = 0; i < count; i++) {
    state.store.set(`v${i}`, {
      id: `v${i}`,
      name: `V${i}`,
      type: "car" as VehicleType,
      position: [-1.28 + (i % 20) * 0.001 + offset, 36.82 + Math.floor(i / 20) * 0.001],
      speed: 30,
      heading: 90,
    } as unknown as VehicleDTO);
  }
  state.version++;
}

interface Props {
  densityMode?: boolean;
}

function renderLayer({ densityMode }: Props = {}) {
  return render(
    <VehiclesLayer
      scale={1.5}
      vehicleFleetMap={new Map<string, Fleet>()}
      hiddenFleetIds={new Set<string>()}
      hiddenVehicleTypes={new Set<VehicleType>()}
      onClick={() => {}}
      densityMode={densityMode}
    />
  );
}

type LayerLike = { id: string; props: Record<string, unknown> };

function iconLayerData(): unknown[] {
  const layers = (registeredLayers.get("vehicles") ?? []) as LayerLike[];
  const icons = layers.find((l) => l.id === "vehicles");
  return (icons?.props.data ?? []) as unknown[];
}

beforeEach(() => {
  registeredLayers.clear();
  state.store.clear();
  state.version = 0;
  rafQueue = [];
  clock = 1000;
  ctx.zoom = 11;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // The RAF loop reads performance.now(), not the frame timestamp, so the
  // publish throttle has to be driven off the same fake clock.
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VehiclesLayer density mode", () => {
  it("publishes sprites normally when density mode is off (hot path unaffected)", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    // Zoomed out far enough that density WOULD engage if it were enabled.
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer({ densityMode: false });
    pumpFrames();

    expect(iconLayerData()).toHaveLength(DENSITY_MIN_VEHICLES + 50);
  });

  it("publishes sprites normally when the prop is omitted entirely", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer();
    pumpFrames();

    expect(iconLayerData()).toHaveLength(DENSITY_MIN_VEHICLES + 50);
  });

  it("suppresses sprites when density mode is on and the view is aggregated", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer({ densityMode: true });
    pumpFrames();

    expect(iconLayerData()).toHaveLength(0);
  });

  it("keeps sprites at the zoom boundary even with density mode on", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD; // inclusive on the sprite side
    renderLayer({ densityMode: true });
    pumpFrames();

    expect(iconLayerData()).toHaveLength(DENSITY_MIN_VEHICLES + 50);
  });

  it("keeps sprites below the vehicle-count threshold even with density mode on", () => {
    seedVehicles(DENSITY_MIN_VEHICLES - 1);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer({ densityMode: true });
    pumpFrames();

    expect(iconLayerData()).toHaveLength(DENSITY_MIN_VEHICLES - 1);
  });

  it("restores sprites when the user zooms back in", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer({ densityMode: true });
    pumpFrames();
    expect(iconLayerData()).toHaveLength(0);

    ctx.zoom = DENSITY_ZOOM_THRESHOLD + 2;
    pumpFrames();
    expect(iconLayerData()).toHaveLength(DENSITY_MIN_VEHICLES + 50);
  });

  it("still tracks positions while aggregated, so returning to sprites is up to date", () => {
    seedVehicles(DENSITY_MIN_VEHICLES + 50);
    ctx.zoom = DENSITY_ZOOM_THRESHOLD - 3;
    renderLayer({ densityMode: true });
    pumpFrames();
    expect(iconLayerData()).toHaveLength(0);

    // Vehicles keep moving while the hexagon plate is on screen…
    seedVehicles(DENSITY_MIN_VEHICLES + 50, 0.05);
    pumpFrames();

    // …and the sprite field comes back at the new positions, not the old ones.
    ctx.zoom = DENSITY_ZOOM_THRESHOLD + 2;
    pumpFrames();
    const data = iconLayerData() as { position: [number, number] }[];
    expect(data).toHaveLength(DENSITY_MIN_VEHICLES + 50);
    expect(data[0].position[1]).toBeCloseTo(-1.23, 2);
  });
});

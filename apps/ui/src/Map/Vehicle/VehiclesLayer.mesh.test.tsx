/**
 * The 3D (mesh) half of the vehicle hot path.
 *
 * Same approach as the density test: drive the RAF loop by hand and assert on
 * the constructed layer props, since jsdom has neither a compositor nor WebGL.
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
const { ctx } = vi.hoisted(() => ({ ctx: { zoom: 16 } }));
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    getZoom: () => ctx.zoom,
    // Degenerate bounds → viewport culling disabled (and latitude 0, which the
    // mesh sizing assertions below take as given).
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

import VehiclesLayer, { MESH_ZOOM_THRESHOLD } from "./VehiclesLayer";
import { MESH_REFERENCE_LENGTH_M } from "./vehicleMeshes";

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

interface Seed {
  id: string;
  type?: string;
  heading?: number;
  speed?: number;
}

function seed(vehicles: Seed[]) {
  state.store.clear();
  vehicles.forEach((v, i) => {
    state.store.set(v.id, {
      id: v.id,
      name: v.id,
      type: v.type as VehicleType,
      position: [-1.28 + i * 0.001, 36.82],
      speed: v.speed ?? 30,
      heading: v.heading ?? 0,
    } as unknown as VehicleDTO);
  });
  state.version++;
}

function renderLayer(props: { selectable?: boolean } = {}) {
  const onClick = vi.fn();
  render(
    <VehiclesLayer
      scale={1.5}
      vehicleFleetMap={new Map<string, Fleet>()}
      hiddenFleetIds={new Set<string>()}
      hiddenVehicleTypes={new Set<VehicleType>()}
      onClick={onClick}
      selectable={props.selectable}
    />
  );
  return onClick;
}

type LayerLike = { id: string; props: Record<string, unknown> };

function layers(): LayerLike[] {
  return (registeredLayers.get("vehicles") ?? []) as LayerLike[];
}

function layerById(id: string): LayerLike | undefined {
  return layers().find((l) => l.id === id);
}

function meshLayers(): LayerLike[] {
  return layers().filter((l) => l.id.startsWith("vehicles-mesh-"));
}

interface MeshDatum {
  id: string;
  orientation: [number, number, number];
  meshColor: [number, number, number, number];
  meshType: string;
}

function meshData(type: string): MeshDatum[] {
  return (layerById(`vehicles-mesh-${type}`)?.props.data ?? []) as MeshDatum[];
}

beforeEach(() => {
  registeredLayers.clear();
  state.store.clear();
  state.version = 0;
  rafQueue = [];
  clock = 1000;
  ctx.zoom = MESH_ZOOM_THRESHOLD;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VehiclesLayer 3D meshes", () => {
  describe("the zoom gate", () => {
    it("draws sprites below the threshold", () => {
      seed([{ id: "v1", type: "car" }]);
      ctx.zoom = MESH_ZOOM_THRESHOLD - 1;
      renderLayer();
      pumpFrames();

      expect(layerById("vehicles")).toBeDefined();
      expect(meshLayers()).toHaveLength(0);
    });

    it("draws meshes at the threshold", () => {
      seed([{ id: "v1", type: "car" }]);
      ctx.zoom = MESH_ZOOM_THRESHOLD;
      renderLayer();
      pumpFrames();

      expect(layerById("vehicles")).toBeUndefined();
      expect(meshLayers()).toHaveLength(1);
      expect(meshData("car")).toHaveLength(1);
    });

    it("swaps back to sprites when the user zooms out", () => {
      seed([{ id: "v1", type: "car" }]);
      renderLayer();
      pumpFrames();
      expect(meshLayers()).toHaveLength(1);

      ctx.zoom = MESH_ZOOM_THRESHOLD - 2;
      pumpFrames();
      expect(meshLayers()).toHaveLength(0);
      expect((layerById("vehicles")?.props.data as unknown[]) ?? []).toHaveLength(1);
    });

    it("keeps the selection ring and halo in both representations", () => {
      seed([{ id: "v1", type: "car" }]);
      renderLayer();
      pumpFrames();
      expect(layerById("vehicle-selection-halo")).toBeDefined();
      expect(layerById("vehicle-highlight-ring")).toBeDefined();

      ctx.zoom = MESH_ZOOM_THRESHOLD - 2;
      pumpFrames();
      expect(layerById("vehicle-selection-halo")).toBeDefined();
      expect(layerById("vehicle-highlight-ring")).toBeDefined();
    });
  });

  describe("bucketing", () => {
    it("draws one layer per vehicle type present, and none for absent types", () => {
      seed([
        { id: "a", type: "car" },
        { id: "b", type: "car" },
        { id: "c", type: "bus" },
      ]);
      renderLayer();
      pumpFrames();

      expect(
        meshLayers()
          .map((l) => l.id)
          .sort()
      ).toEqual(["vehicles-mesh-bus", "vehicles-mesh-car"]);
      expect(meshData("car").map((d) => d.id)).toEqual(["a", "b"]);
      expect(meshData("bus").map((d) => d.id)).toEqual(["c"]);
    });

    it("gives every type its own mesh geometry", () => {
      seed([
        { id: "a", type: "car" },
        { id: "b", type: "truck" },
      ]);
      renderLayer();
      pumpFrames();

      const car = layerById("vehicles-mesh-car")?.props.mesh;
      const truck = layerById("vehicles-mesh-truck")?.props.mesh;
      expect(car).toBeDefined();
      expect(truck).toBeDefined();
      expect(car).not.toBe(truck);
    });

    it("falls an unknown type back to the car bucket", () => {
      seed([{ id: "a", type: "hovercraft" }]);
      renderLayer();
      pumpFrames();

      expect(meshData("car").map((d) => d.id)).toEqual(["a"]);
    });
  });

  describe("orientation", () => {
    it("yaws by the negated compass heading, level in pitch and roll", () => {
      seed([{ id: "v1", type: "car", heading: 90 }]);
      renderLayer();
      pumpFrames();

      const [datum] = meshData("car");
      expect(datum.orientation[0]).toBe(0);
      expect(datum.orientation[1]).toBeCloseTo(-90, 6);
      expect(datum.orientation[2]).toBe(0);
    });

    it("matches the sprite rotation it replaces", () => {
      // The two representations must agree, or a vehicle spins on the swap.
      seed([{ id: "v1", type: "car", heading: 215 }]);
      renderLayer();
      pumpFrames();
      const meshYaw = meshData("car")[0].orientation[1];

      ctx.zoom = MESH_ZOOM_THRESHOLD - 2;
      pumpFrames();
      const sprites = (layerById("vehicles")?.props.data ?? []) as { angle: number }[];
      const spriteAngle = sprites[0].angle;

      expect(meshYaw).toBeCloseTo(spriteAngle, 6);
    });
  });

  describe("colour", () => {
    it("dims a near-idle vehicle instead of making it translucent", () => {
      // A semi-transparent solid blends its own back faces over its front ones.
      seed([
        { id: "moving", type: "car", speed: 30 },
        { id: "idle", type: "car", speed: 0 },
      ]);
      renderLayer();
      pumpFrames();

      const [moving, idle] = meshData("car");
      expect(moving.meshColor[3]).toBe(255);
      expect(idle.meshColor[3]).toBe(255);
      expect(idle.meshColor[0]).toBeLessThan(moving.meshColor[0]);
    });

    it("interns colours so the publish allocates none", () => {
      seed([
        { id: "a", type: "car" },
        { id: "b", type: "car" },
      ]);
      renderLayer();
      pumpFrames();

      const [a, b] = meshData("car");
      expect(a.meshColor).toBe(b.meshColor);
    });

    it("keeps the same reference across publishes", () => {
      seed([{ id: "a", type: "car" }]);
      renderLayer();
      pumpFrames();
      const first = meshData("car")[0].meshColor;

      seed([{ id: "a", type: "car" }]);
      pumpFrames();
      expect(meshData("car")[0].meshColor).toBe(first);
    });
  });

  describe("sizing", () => {
    it("covers the same pixels the sprite did, less the halo allowance", () => {
      seed([{ id: "v1", type: "car" }]);
      renderLayer();
      pumpFrames();

      const sizeScale = layerById("vehicles-mesh-car")?.props.sizeScale as number;
      // Ground resolution at the mocked latitude 0.
      const metersPerPixel = 156543.03392 / 2 ** MESH_ZOOM_THRESHOLD;
      const onScreenPx = (sizeScale * MESH_REFERENCE_LENGTH_M) / metersPerPixel;
      // The sprite is 24px at the reference zoom; meshes are drawn at 0.95 of it.
      expect(onScreenPx).toBeCloseTo(24 * 0.95, 4);
    });

    it("grows the ground footprint as the camera zooms out", () => {
      seed([{ id: "v1", type: "car" }]);
      renderLayer();
      pumpFrames();
      const atThreshold = layerById("vehicles-mesh-car")?.props.sizeScale as number;

      ctx.zoom = MESH_ZOOM_THRESHOLD + 2;
      pumpFrames();
      const zoomedIn = layerById("vehicles-mesh-car")?.props.sizeScale as number;

      // Metres per pixel falls faster than the damped pixel size grows, so a
      // vehicle covers less ground (and more screen) the further in you go.
      expect(zoomedIn).toBeLessThan(atThreshold);
      expect(zoomedIn).toBeGreaterThan(0);
    });
  });

  describe("picking", () => {
    it("selects the vehicle and claims the click", () => {
      seed([{ id: "v1", type: "car" }]);
      const onClick = renderLayer();
      pumpFrames();

      const layer = layerById("vehicles-mesh-car");
      const handler = layer?.props.onClick as (info: { object?: { id: string } }) => unknown;
      expect(handler({ object: { id: "v1" } })).toBe(true);
      expect(onClick).toHaveBeenCalledWith("v1");
    });

    it("falls through when not selectable, so point-picking modes still work", () => {
      seed([{ id: "v1", type: "car" }]);
      const onClick = renderLayer({ selectable: false });
      pumpFrames();

      const layer = layerById("vehicles-mesh-car");
      const handler = layer?.props.onClick as (info: { object?: { id: string } }) => unknown;
      expect(handler({ object: { id: "v1" } })).toBe(false);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("is pickable", () => {
      seed([{ id: "v1", type: "car" }]);
      renderLayer();
      pumpFrames();

      expect(layerById("vehicles-mesh-car")?.props.pickable).toBe(true);
    });
  });
});

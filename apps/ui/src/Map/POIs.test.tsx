import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { POI } from "@/types";
import { createPOI } from "@/test/mocks/types";

// ---------------------------------------------------------------------------
// jsdom has no WebGL (and no 2D canvas), so these assert on constructed layer
// props: which POIs reach the icon layer, and which icon each one asks for.
// ---------------------------------------------------------------------------
const { registeredLayers, poisRef } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
  poisRef: { current: [] as POI[] },
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
  useDeckLayersContext: () => ({
    registerLayers: () => {},
    unregisterLayers: () => {},
  }),
}));

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({
    getZoom: () => 16,
    getBoundingBox: () => [
      [36.6, -1.45],
      [37.05, -1.15],
    ],
    viewport: null,
    viewState: { zoom: 16 },
  }),
}));

vi.mock("@/hooks/usePois", () => ({
  usePois: () => ({ pois: poisRef.current }),
}));

vi.mock("@/hooks/useSpeedLimits", () => ({
  useSpeedLimits: () => ({ signs: [] }),
}));

import POIs from "./POIs";
import { GROUP_META } from "./POI/categories";
import SpeedLimitSigns from "./SpeedLimitSigns";

interface LayerLike {
  props: Record<string, unknown> & { id: string };
}

function getLayer(group: string, id: string): LayerLike {
  const layers = (registeredLayers.get(group) ?? []) as LayerLike[];
  const layer = layers.find((l) => l.props.id === id);
  if (!layer) throw new Error(`layer ${id} not registered`);
  return layer;
}

function renderPois(pois: POI[]) {
  poisRef.current = pois;
  render(<POIs visible onClick={() => {}} />);
  return getLayer("pois", "pois");
}

beforeEach(() => {
  registeredLayers.clear();
  poisRef.current = [];
});

describe("POIs", () => {
  it("drops POIs whose type has no semantic group", () => {
    const layer = renderPois([
      createPOI({ id: "p1", name: "Public toilets", type: "toilets" }),
      createPOI({ id: "p2", name: "Kenyatta Hospital", type: "hospital" }),
    ]);

    const data = layer.props.data as { poi: POI }[];
    expect(data.map((d) => d.poi.id)).toEqual(["p2"]);
  });

  it("drops POIs with no name", () => {
    const layer = renderPois([createPOI({ id: "p1", name: "", type: "hospital" })]);
    expect(layer.props.data).toEqual([]);
  });

  it("asks for the group icon, not the raw OSM type", () => {
    const layer = renderPois([createPOI({ id: "p1", name: "Kilimani Primary", type: "school" })]);

    const getIcon = layer.props.getIcon as (d: unknown) => string;
    const data = layer.props.data as unknown[];
    expect(getIcon(data[0])).toBe("education");
  });

  it("draws wayfinding anchors larger than the ambient carpet", () => {
    const layer = renderPois([
      createPOI({ id: "p1", name: "Stage", type: "bus_stop" }),
      createPOI({ id: "p2", name: "Shell", type: "fuel" }),
      createPOI({ id: "p3", name: "Kenyatta Hospital", type: "hospital" }),
      createPOI({ id: "p4", name: "Java House", type: "cafe" }),
    ]);

    const getSize = layer.props.getSize as (d: unknown) => number;
    const data = layer.props.data as unknown[];
    // transit, fuel and health are anchors — bus stops included.
    expect(getSize(data[0])).toBe(22);
    expect(getSize(data[1])).toBe(22);
    expect(getSize(data[2])).toBe(22);
    expect(getSize(data[3])).toBe(18);
  });

  it("holds icons apart more widely below street zoom", () => {
    // The mocked viewport sits at zoom 16, so this is the tight setting.
    const layer = renderPois([createPOI({ id: "p1", name: "Shell", type: "fuel" })]);
    const collisionTestProps = layer.props.collisionTestProps as { sizeScale: number };
    expect(collisionTestProps.sizeScale).toBe(2.5);
    expect(layer.props.collisionEnabled).toBe(true);
  });

  it("gates the carpet groups later than the wayfinding anchors", () => {
    // The icon fades in via getColor alpha, so the gate is observable there.
    const layer = renderPois([
      createPOI({ id: "p1", name: "Kenyatta Hospital", type: "hospital" }),
      createPOI({ id: "p2", name: "Java House", type: "cafe" }),
    ]);
    const getColor = layer.props.getColor as (d: unknown) => number[];
    const data = layer.props.data as { group: string }[];
    // At the mocked zoom 16 both are past their gate...
    expect(getColor(data[0])[3]).toBe(255);
    expect(getColor(data[1])[3]).toBe(255);
    // ...but the cafe's gate is the later of the two.
    expect(GROUP_META.food.minZoom).toBeGreaterThan(GROUP_META.health.minZoom);
    expect(GROUP_META.food.minZoom).toBeGreaterThanOrEqual(14.5);
  });

  it("keeps icon collision priority in step with the group meta", () => {
    const layer = renderPois([
      createPOI({ id: "p1", name: "Clinic", type: "clinic" }),
      createPOI({ id: "p2", name: "Cinema", type: "cinema" }),
    ]);

    const priority = layer.props.getCollisionPriority as (d: unknown) => number;
    const data = layer.props.data as unknown[];
    expect(priority(data[0])).toBeGreaterThan(priority(data[1]));
  });
});

describe("SpeedLimitSigns", () => {
  it("keeps signs small enough to stay out of the way", () => {
    render(<SpeedLimitSigns visible />);
    const layer = getLayer("speed-limit-signs", "speed-limit-signs");
    expect(layer.props.getSize).toBe(22);
    expect(layer.props.sizeMinPixels).toBe(16);
    expect(layer.props.sizeMaxPixels).toBe(28);
    // Shared with the POI icons so the two declutter against each other.
    expect(layer.props.collisionGroup).toBe("map-markers");
  });
});

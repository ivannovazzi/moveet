import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { GeoFence } from "@moveet/shared-types";

// ---------------------------------------------------------------------------
// Capture registered layers via useRegisterLayers mock (jsdom has no WebGL —
// assert on constructed layer props, not pixels).
// ---------------------------------------------------------------------------
const { registeredLayers } = vi.hoisted(() => {
  const registeredLayers = new Map<string, unknown[]>();
  return { registeredLayers };
});

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
  useDeckLayersContext: () => ({
    registerLayers: () => {},
    unregisterLayers: () => {},
  }),
}));

import GeofenceLayer from "./GeofenceLayer";

function makeFence(overrides: Partial<GeoFence> = {}): GeoFence {
  return {
    id: "fence-1",
    name: "Depot Zone",
    type: "delivery",
    active: true,
    polygon: [
      [36.8, -1.28],
      [36.82, -1.28],
      [36.82, -1.3],
      [36.8, -1.3],
    ],
    ...overrides,
  } as GeoFence;
}

interface LayerLike {
  props: {
    id: string;
    pickable: boolean;
    onClick?: (info: { object?: GeoFence }) => boolean;
    updateTriggers?: Record<string, unknown>;
    getLineWidth: (d: GeoFence) => number;
  };
}

function getLayer(id: string): LayerLike {
  const layers = (registeredLayers.get("geofences") ?? []) as LayerLike[];
  const layer = layers.find((l) => l.props.id === id);
  if (!layer) throw new Error(`layer ${id} not registered`);
  return layer;
}

beforeEach(() => {
  registeredLayers.clear();
});

describe("GeofenceLayer", () => {
  it("registers no layers when there are no fences", () => {
    render(<GeofenceLayer fences={[]} />);
    expect(registeredLayers.get("geofences")).toEqual([]);
  });

  it("fence polygons are pickable; labels are not", () => {
    render(<GeofenceLayer fences={[makeFence()]} />);
    expect(getLayer("geofences").props.pickable).toBe(true);
    expect(getLayer("geofence-labels").props.pickable).toBe(false);
  });

  it("onClick selects the clicked fence and returns true (marks the event handled)", () => {
    const onFenceClick = vi.fn();
    const fence = makeFence();
    render(<GeofenceLayer fences={[fence]} onFenceClick={onFenceClick} />);

    const handled = getLayer("geofences").props.onClick!({ object: fence });

    expect(onFenceClick).toHaveBeenCalledWith("fence-1");
    expect(handled).toBe(true);
  });

  it("onClick without a picked object does not fire the callback and lets the event bubble", () => {
    const onFenceClick = vi.fn();
    render(<GeofenceLayer fences={[makeFence()]} onFenceClick={onFenceClick} />);

    const handled = getLayer("geofences").props.onClick!({});

    expect(onFenceClick).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it("still marks a fence click handled when no onFenceClick is wired", () => {
    const fence = makeFence();
    render(<GeofenceLayer fences={[fence]} />);
    expect(getLayer("geofences").props.onClick!({ object: fence })).toBe(true);
  });

  it("draws the selected fence with a thicker outline and pins it via updateTriggers", () => {
    const fence = makeFence();
    const other = makeFence({ id: "fence-2", name: "Other" });
    render(<GeofenceLayer fences={[fence, other]} selectedFenceId="fence-1" />);

    const layer = getLayer("geofences");
    expect(layer.props.getLineWidth(fence)).toBe(2);
    expect(layer.props.getLineWidth(other)).toBe(1);
    expect(layer.props.updateTriggers?.getLineWidth).toBe("fence-1");
  });
});

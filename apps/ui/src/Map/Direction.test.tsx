import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Route } from "@/types";
import type * as UseDirectionsModule from "@/hooks/useDirections";
import type { DirectionState } from "@/hooks/useDirections";

// ---------------------------------------------------------------------------
// Capture registered layers via useRegisterLayers mock
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

// ---------------------------------------------------------------------------
// Mock useDirections so the test controls the Map reference/content directly,
// simulating the `new Map(prev)` reference churn produced on every WS update.
// ---------------------------------------------------------------------------
const { directionsRef } = vi.hoisted(() => {
  return { directionsRef: { current: new Map<string, unknown>() } };
});

vi.mock("@/hooks/useDirections", async () => {
  const actual = await vi.importActual<typeof UseDirectionsModule>("@/hooks/useDirections");
  return {
    ...actual,
    useDirections: () => directionsRef.current,
  };
});

import DirectionMap from "./Direction";

function createRoute(distance: number): Route {
  return { edges: [], distance };
}

function createDirection(distance: number): DirectionState {
  return { route: createRoute(distance) };
}

function getLayers(): { props: Record<string, unknown> }[] {
  return (registeredLayers.get("directions") ?? []) as { props: Record<string, unknown> }[];
}

function getLayer(id: string) {
  return getLayers().find((l) => l.props.id === id);
}

describe("DirectionMap", () => {
  beforeEach(() => {
    registeredLayers.clear();
    directionsRef.current = new Map();
  });

  it("registers no layers when neither selected nor hovered is set", () => {
    directionsRef.current = new Map([["v1", createDirection(100)]]);
    render(<DirectionMap />);
    expect(getLayers().length).toBe(0);
  });

  it("builds a path layer with data for the selected vehicle", () => {
    directionsRef.current = new Map([["v1", createDirection(100)]]);
    render(<DirectionMap selected="v1" />);

    const pathLayer = getLayer("direction-paths");
    expect(pathLayer).toBeTruthy();
    expect((pathLayer!.props.data as unknown[]).length).toBe(1);
  });

  it("does not rebuild the layer instances when an unrelated vehicle's direction changes", () => {
    directionsRef.current = new Map([
      ["v1", createDirection(100)],
      ["v2", createDirection(200)],
    ]);

    const { rerender } = render(<DirectionMap selected="v1" />);
    const firstLayers = getLayers();
    const firstPathLayer = getLayer("direction-paths");
    expect(firstPathLayer).toBeTruthy();

    // Simulate useDirections producing a brand-new Map reference (as the real
    // hook does on every WS update) but where only vehicle v2 — which is
    // neither selected nor hovered — actually changed content.
    const nextMap = new Map(directionsRef.current);
    nextMap.set("v2", createDirection(999));
    directionsRef.current = nextMap;

    rerender(<DirectionMap selected="v1" />);
    const secondLayers = getLayers();
    const secondPathLayer = getLayer("direction-paths");

    // The layer array reference and the path layer instance itself should be
    // unchanged since v1's data (the only rendered vehicle) didn't change.
    expect(secondLayers).toBe(firstLayers);
    expect(secondPathLayer).toBe(firstPathLayer);
  });

  it("rebuilds the layers when the selected vehicle's own direction changes", () => {
    directionsRef.current = new Map([["v1", createDirection(100)]]);

    const { rerender } = render(<DirectionMap selected="v1" />);
    const firstPathLayer = getLayer("direction-paths");

    const nextMap = new Map(directionsRef.current);
    nextMap.set("v1", createDirection(150));
    directionsRef.current = nextMap;

    rerender(<DirectionMap selected="v1" />);
    const secondPathLayer = getLayer("direction-paths");

    expect(secondPathLayer).not.toBe(firstPathLayer);
    const data = secondPathLayer!.props.data as { direction: DirectionState }[];
    expect(data[0].direction.route.distance).toBe(150);
  });

  it("builds separate colored entries for hovered and selected vehicles", () => {
    directionsRef.current = new Map([
      ["v1", createDirection(100)],
      ["v2", createDirection(200)],
    ]);

    render(<DirectionMap selected="v1" hovered="v2" />);

    const pathLayer = getLayer("direction-paths");
    expect(pathLayer).toBeTruthy();
    const data = pathLayer!.props.data as { id: string }[];
    expect(data.map((d) => d.id).sort()).toEqual(["v1--selected", "v2--hovered"]);
  });
});

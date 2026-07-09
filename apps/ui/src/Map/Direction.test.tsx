import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Edge, Node, Position, Route } from "@/types";
import type * as UseDirectionsModule from "@/hooks/useDirections";
import type { DirectionState } from "@/hooks/useDirections";
import {
  clearDirectionHighlight,
  setHoveredStep,
  togglePinnedStep,
} from "@/hooks/directionHighlightStore";

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

function node(coordinates: Position): Node {
  return { id: `n${coordinates.join(",")}`, coordinates, connections: [] };
}

let edgeSeq = 0;
function edge(start: Position, end: Position): Edge {
  edgeSeq += 1;
  return {
    id: `e${edgeSeq}`,
    streetId: `s${edgeSeq}`,
    start: node(start),
    end: node(end),
    distance: 1,
    bearing: 0,
    highway: "residential",
    maxSpeed: 50,
    surface: "asphalt",
    oneway: false,
  };
}

/** A direction whose route has `n` unit edges laid along the lat axis. */
function createDirectionWithEdges(n: number): DirectionState {
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) edges.push(edge([i, 0], [i + 1, 0]));
  return { route: { edges, distance: n } };
}

function getLayers(): { props: Record<string, unknown> }[] {
  return (registeredLayers.get("directions") ?? []) as {
    props: Record<string, unknown>;
  }[];
}

function getLayer(id: string) {
  return getLayers().find((l) => l.props.id === id);
}

function getHighlightLayers(): { props: Record<string, unknown> }[] {
  return (registeredLayers.get("direction-highlight") ?? []) as {
    props: Record<string, unknown>;
  }[];
}

describe("DirectionMap", () => {
  beforeEach(() => {
    registeredLayers.clear();
    directionsRef.current = new Map();
    clearDirectionHighlight();
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

  describe("step highlight", () => {
    it("registers no highlight layers when no step is highlighted", () => {
      directionsRef.current = new Map([["v1", createDirectionWithEdges(5)]]);
      render(<DirectionMap selected="v1" />);
      expect(getHighlightLayers().length).toBe(0);
    });

    it("overlays the hovered step's sub-path for the selected vehicle", () => {
      directionsRef.current = new Map([["v1", createDirectionWithEdges(5)]]);
      setHoveredStep({ vehicleId: "v1", start: 1, end: 3 });
      render(<DirectionMap selected="v1" />);

      const highlight = getHighlightLayers().find(
        (l) => l.props.id === "direction-step-highlight-path"
      );
      expect(highlight).toBeTruthy();
      // 2 edges (indices 1,2) → 3 points, and edge coords [lat,lng] are
      // inverted to [lng,lat] for the map.
      const data = highlight!.props.data as { path: [number, number][] }[];
      expect(data[0].path).toEqual([
        [0, 1],
        [0, 2],
        [0, 3],
      ]);
    });

    it("draws a start marker at the step's maneuver point", () => {
      directionsRef.current = new Map([["v1", createDirectionWithEdges(5)]]);
      togglePinnedStep({ vehicleId: "v1", start: 2, end: 4 });
      render(<DirectionMap selected="v1" />);

      const marker = getHighlightLayers().find(
        (l) => l.props.id === "direction-step-highlight-start"
      );
      expect(marker).toBeTruthy();
      const data = marker!.props.data as { position: [number, number] }[];
      expect(data[0].position).toEqual([0, 2]);
    });

    it("ignores a highlight that targets a different vehicle", () => {
      directionsRef.current = new Map([["v1", createDirectionWithEdges(5)]]);
      setHoveredStep({ vehicleId: "v2", start: 0, end: 2 });
      render(<DirectionMap selected="v1" />);
      expect(getHighlightLayers().length).toBe(0);
    });
  });
});

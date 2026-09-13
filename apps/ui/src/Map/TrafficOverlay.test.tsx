import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TrafficEdge } from "@/types";

const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

let edges: TrafficEdge[] = [];
vi.mock("@/hooks/useTraffic", () => ({
  useTraffic: () => ({ edges, loading: false }),
}));

import TrafficOverlay, { buildTrafficSegments, interpolateStops } from "./TrafficOverlay";

function edge(overrides: Partial<TrafficEdge> = {}): TrafficEdge {
  return {
    edgeId: "e1",
    congestion: 1,
    coordinates: [
      [36.8, -1.28],
      [36.81, -1.28],
    ],
    highway: "primary",
    streetId: "s1",
    ...overrides,
  };
}

interface LayerLike {
  id: string;
  props: { data: unknown[]; widthUnits: string };
}

describe("buildTrafficSegments", () => {
  it("merges forward and reverse edges of one segment, keeping the worst congestion", () => {
    const segments = buildTrafficSegments([
      edge({ edgeId: "fwd", congestion: 0.9 }),
      edge({
        edgeId: "rev",
        congestion: 0.4,
        coordinates: [
          [36.81, -1.28],
          [36.8, -1.28],
        ],
      }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0].congestion).toBe(0.4);
  });

  it("keeps distinct segments of the same street separate", () => {
    const segments = buildTrafficSegments([
      edge({ congestion: 0.3 }),
      edge({
        congestion: 1,
        coordinates: [
          [36.81, -1.28],
          [36.82, -1.28],
        ],
      }),
    ]);
    expect(segments.map((s) => s.congestion)).toEqual([1, 0.3]);
  });

  it("sizes by highway class with a fallback for minor roads", () => {
    const [motorway] = buildTrafficSegments([edge({ highway: "motorway" })]);
    const [residential] = buildTrafficSegments([edge({ highway: "residential" })]);
    expect(motorway.widthMeters).toBeGreaterThan(residential.widthMeters);
  });

  it("skips degenerate geometry", () => {
    expect(buildTrafficSegments([edge({ coordinates: [[36.8, -1.28]] })])).toEqual([]);
  });
});

describe("interpolateStops", () => {
  const stops: Array<[number, [number, number, number, number]]> = [
    [0, [0, 0, 0, 255]],
    [1, [200, 100, 50, 255]],
  ];

  it("clamps outside the stop range", () => {
    expect(interpolateStops(stops, -1)).toEqual([0, 0, 0, 255]);
    expect(interpolateStops(stops, 2)).toEqual([200, 100, 50, 255]);
  });

  it("returns stop colours exactly at their values", () => {
    expect(interpolateStops(stops, 1)).toEqual([200, 100, 50, 255]);
  });

  it("blends in perceptual (OKLab) space", () => {
    const grey: Array<[number, [number, number, number, number]]> = [
      [0, [0, 0, 0, 255]],
      [1, [255, 255, 255, 255]],
    ];
    // OKLab L = 0.5 is sRGB ~99, not the naive sRGB midpoint 128.
    expect(interpolateStops(grey, 0.5)).toEqual([99, 99, 99, 255]);
  });
});

describe("TrafficOverlay", () => {
  beforeEach(() => {
    registeredLayers.clear();
    edges = [];
  });

  it("registers no layers without traffic data but still shows the legend", () => {
    render(<TrafficOverlay visible={true} />);
    expect(registeredLayers.get("traffic-overlay")).toEqual([]);
    expect(screen.getByTestId("traffic-legend-min").textContent).toBe("Jammed");
    expect(screen.getByTestId("traffic-legend-max").textContent).toBe("Free flow");
  });

  it("draws a casing under the colour line, both in meters", () => {
    edges = [edge({ congestion: 0.5 })];
    render(<TrafficOverlay visible={true} />);
    const layers = registeredLayers.get("traffic-overlay") as LayerLike[];
    expect(layers.map((l) => l.id)).toEqual(["traffic-overlay-casing", "traffic-overlay"]);
    for (const l of layers) {
      expect(l.props.widthUnits).toBe("meters");
      expect(l.props.data).toHaveLength(1);
    }
  });

  it("renders nothing when hidden", () => {
    edges = [edge()];
    render(<TrafficOverlay visible={false} />);
    expect(registeredLayers.get("traffic-overlay")).toEqual([]);
    expect(screen.queryByTestId("traffic-legend")).toBeNull();
  });
});

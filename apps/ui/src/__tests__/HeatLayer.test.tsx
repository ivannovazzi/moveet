import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Position } from "@/types";

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

// Zoom drives the blur radius.
const { ctx } = vi.hoisted(() => ({ ctx: { zoom: 12 } }));
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({ viewState: { zoom: ctx.zoom } }),
}));

import HeatLayer, {
  heatRadiusForZoom,
  resetHeatColorRange,
} from "@/components/Map/components/HeatLayer";
import Heatmap from "@/Map/Heatmap";
import type { Vehicle } from "@/types";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  registeredLayers.clear();
  ctx.zoom = 12;
  // Clears the ramp memo *and* resolveMapColor's cache underneath it, so a
  // test can't inherit colours another file resolved.
  resetHeatColorRange();
});

interface HeatLayerProps {
  colorRange: number[][];
  radiusPixels: number;
  threshold: number;
  opacity: number;
  intensity: number;
}

function heatProps(): HeatLayerProps {
  const layers = registeredLayers.get("heatmap") as Array<{ props: HeatLayerProps }>;
  return layers[0].props;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HeatLayer (deck.gl)", () => {
  it("registers a heatmap layer with the correct id", () => {
    const data: Position[] = [[36.82, -1.29]];

    render(<HeatLayer data={data} />);

    expect(registeredLayers.has("heatmap")).toBe(true);
    const layers = registeredLayers.get("heatmap")!;
    expect(layers.length).toBe(1);
  });

  it("registers empty layers array for empty data", () => {
    render(<HeatLayer data={[]} />);

    const layers = registeredLayers.get("heatmap")!;
    expect(layers.length).toBe(0);
  });

  it("passes data to the HeatmapLayer", () => {
    const data: Position[] = [
      [36.82, -1.29],
      [36.83, -1.3],
    ];

    render(<HeatLayer data={data} />);

    const layers = registeredLayers.get("heatmap")!;
    expect(layers.length).toBe(1);
    const layer = layers[0] as { props: { data: Position[]; id: string } };
    expect(layer.props.id).toBe("heatmap");
    expect(layer.props.data).toEqual(data);
  });

  it("uses custom opacity value", () => {
    const data: Position[] = [[36.82, -1.29]];

    render(<HeatLayer data={data} opacity={0.8} />);

    const layers = registeredLayers.get("heatmap")!;
    const layer = layers[0] as { props: { opacity: number } };
    expect(layer.props.opacity).toBe(0.8);
  });

  it("uses default opacity of 0.55", () => {
    const data: Position[] = [[36.82, -1.29]];

    render(<HeatLayer data={data} />);

    const layers = registeredLayers.get("heatmap")!;
    const layer = layers[0] as { props: { opacity: number } };
    expect(layer.props.opacity).toBe(0.55);
  });

  it("colours from the five-step token ramp, not a rainbow", () => {
    render(<HeatLayer data={[[36.82, -1.29]]} />);

    const { colorRange } = heatProps();
    expect(colorRange).toHaveLength(5);
    // jsdom cannot resolve oklch tokens, so every step falls back to the same
    // grey — what matters here is that the layer got the resolved array.
    for (const step of colorRange) expect(step).toHaveLength(4);
  });

  it("hands the layer the same ramp reference twice, so it never re-uploads", () => {
    const { rerender } = render(<HeatLayer data={[[36.82, -1.29]]} />);
    const first = heatProps().colorRange;
    rerender(<HeatLayer data={[[36.83, -1.3]]} />);
    expect(heatProps().colorRange).toBe(first);
  });

  it("drops the faintest tail of the kernel", () => {
    render(<HeatLayer data={[[36.82, -1.29]]} />);
    expect(heatProps().threshold).toBe(0.08);
    expect(heatProps().intensity).toBe(1);
  });

  it("sizes its blur radius from the current zoom", () => {
    ctx.zoom = 10;
    const { rerender } = render(<HeatLayer data={[[36.82, -1.29]]} />);
    expect(heatProps().radiusPixels).toBe(18);

    ctx.zoom = 16.5;
    rerender(<HeatLayer data={[[36.83, -1.3]]} />);
    expect(heatProps().radiusPixels).toBe(48);
  });

  it("updates layers when data changes", () => {
    const data1: Position[] = [[36.82, -1.29]];
    const data2: Position[] = [
      [36.83, -1.3],
      [36.84, -1.31],
    ];

    const { rerender } = render(<HeatLayer data={data1} />);

    let layers = registeredLayers.get("heatmap")!;
    expect(layers.length).toBe(1);

    rerender(<HeatLayer data={data2} />);

    layers = registeredLayers.get("heatmap")!;
    const layer = layers[0] as { props: { data: Position[] } };
    expect(layer.props.data).toEqual(data2);
  });
});

describe("heatRadiusForZoom", () => {
  it("clamps to a tight kernel when zoomed right out", () => {
    expect(heatRadiusForZoom(11)).toBe(18);
    expect(heatRadiusForZoom(8)).toBe(18);
  });

  it("clamps to a wide kernel at street level", () => {
    expect(heatRadiusForZoom(16)).toBe(48);
    expect(heatRadiusForZoom(19)).toBe(48);
  });

  it("interpolates linearly between the anchors", () => {
    expect(heatRadiusForZoom(14)).toBe(30);
    expect(heatRadiusForZoom(12.5)).toBe(24);
    expect(heatRadiusForZoom(15)).toBe(39);
  });

  it("buckets to half-zoom steps so a wheel tick does not re-aggregate", () => {
    expect(heatRadiusForZoom(12.6)).toBe(heatRadiusForZoom(12.5));
    expect(heatRadiusForZoom(12.4)).toBe(heatRadiusForZoom(12.5));
  });

  it("falls back to a usable radius for a non-finite zoom", () => {
    expect(heatRadiusForZoom(Number.NaN)).toBe(heatRadiusForZoom(12));
  });
});

describe("Heatmap", () => {
  const vehicle = (position: Position) => ({ id: "v1", position }) as unknown as Vehicle;

  it("renders the heat legend beside the layer it explains", () => {
    render(<Heatmap vehicles={[vehicle([36.82, -1.29])]} />);

    expect(screen.getByTestId("heat-legend")).toHaveAttribute("aria-label", "Vehicle heat");
    expect(screen.getAllByTestId("heat-legend-step")).toHaveLength(5);
  });

  it("gives the legend the exact ramp the layer drew with", () => {
    render(<Heatmap vehicles={[vehicle([36.82, -1.29])]} />);

    const swatches = screen.getAllByTestId("heat-legend-step");
    expect(swatches).toHaveLength(heatProps().colorRange.length);
  });

  it("has no countable domain, so it shows no numbers", () => {
    render(<Heatmap vehicles={[vehicle([36.82, -1.29])]} />);

    expect(screen.queryByTestId("heat-legend-min")).toBeNull();
    expect(screen.queryByTestId("heat-legend-max")).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
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

import HeatLayer from "@/components/Map/components/HeatLayer";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  registeredLayers.clear();
});

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

  it("uses default opacity of 0.5", () => {
    const data: Position[] = [[36.82, -1.29]];

    render(<HeatLayer data={data} />);

    const layers = registeredLayers.get("heatmap")!;
    const layer = layers[0] as { props: { opacity: number } };
    expect(layer.props.opacity).toBe(0.5);
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

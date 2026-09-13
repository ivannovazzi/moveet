import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// ── Capture registered layers by id ────────────────────────────────
const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

// project: [lng,lat] -> [lng*100, lat*100]; unproject inverts it.
const mapEl = document.createElement("div");
const viewport = {
  project: ([lng, lat]: [number, number]) => [lng * 100, lat * 100],
  unproject: ([x, y]: [number, number]) => [x / 100, y / 100],
};
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({ viewport }),
  useOverlay: () => ({ mapHTMLElement: mapEl }),
}));

import GeofenceDrawTool from "./GeofenceDrawTool";

function clickAt(x: number, y: number) {
  mapEl.dispatchEvent(
    new MouseEvent("click", { clientX: x, clientY: y, button: 0, bubbles: true })
  );
}
function moveTo(x: number, y: number) {
  mapEl.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, button: 0, bubbles: true })
  );
}

interface LayerProps {
  id: string;
  [key: string]: unknown;
}
function layersById(): Map<string, LayerProps> {
  const out = new Map<string, LayerProps>();
  for (const l of (registeredLayers.get("geofence-draw") ?? []) as { props: LayerProps }[]) {
    out.set(l.props.id, l.props);
  }
  return out;
}

/** Places a triangle at pixel (0,0) (100,0) (100,100). */
function drawTriangle() {
  act(() => {
    clickAt(0, 0);
    clickAt(100, 0);
    clickAt(100, 100);
  });
}

beforeEach(() => {
  registeredLayers.clear();
});

describe("GeofenceDrawTool layers", () => {
  it("registers nothing before the first vertex", () => {
    render(<GeofenceDrawTool active onComplete={vi.fn()} />);
    expect(registeredLayers.get("geofence-draw")).toEqual([]);
  });

  it("fills the closed polygon at the draw token's 48 alpha with a 2px outline", () => {
    render(<GeofenceDrawTool active onComplete={vi.fn()} />);
    drawTriangle();
    const polygon = layersById().get("geofence-draw-polygon")!;
    expect(polygon).toBeDefined();
    expect((polygon.getFillColor as number[])[3]).toBe(48);
    expect(polygon.getLineWidth).toBe(2);
    expect(polygon.filled).toBe(true);
  });

  it("dashes the cursor preview line at 1.5px", () => {
    render(<GeofenceDrawTool active onComplete={vi.fn()} />);
    act(() => {
      clickAt(0, 0);
    });
    // Far from the single vertex, so the preview is not suppressed by hover.
    act(() => {
      moveTo(300, 300);
    });
    const lines = layersById().get("geofence-draw-lines")!;
    expect(lines).toBeDefined();
    expect(lines.getWidth).toBe(1.5);
    expect(lines.getDashArray).toEqual([4, 3]);
    expect(lines.dashJustified).toBe(true);
    expect((lines.extensions as unknown[]).length).toBe(1);
  });

  it("draws white vertex handles ringed in the draw colour, enlarging on hover", () => {
    render(<GeofenceDrawTool active onComplete={vi.fn()} />);
    drawTriangle();
    const verts = layersById().get("geofence-draw-vertices")!;
    const getRadius = verts.getRadius as (d: { enlarged: boolean }) => number;
    expect(getRadius({ enlarged: false })).toBe(5);
    expect(getRadius({ enlarged: true })).toBe(7);
    expect(verts.getLineWidth).toBe(2);
    // Fill is the map-label ink; the close target swaps to the close token.
    // (Under jsdom both tokens resolve to the same fallback RGB, so assert the
    // accessor shape rather than the bytes.)
    expect(typeof verts.getFillColor).toBe("function");
    expect(verts.stroked).toBe(true);
  });
});

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

// jsdom has no WebGL, so these assert on what gets fetched and on the
// constructed layer props, the same way the other overlay tests do.
const { registeredLayers, viewportRef } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
  viewportRef: {
    current: null as null | { zoom: number; getBounds: () => number[] },
  },
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({ viewport: viewportRef.current }),
}));

import BuildingsLayer, { BUILDINGS_MIN_ZOOM } from "./BuildingsLayer";
import { resetBuildingsData } from "./buildingsData";
import { getBuildingsStatus } from "./buildingsStatus";

interface LayerLike {
  props: Record<string, unknown> & { id: string };
}

const INDEX = {
  version: 1,
  zoom: 14,
  scale: 1e6,
  bbox: [36.65, -1.45, 37.1, -1.15],
  buildings: 2,
  // Central Nairobi, plus one far outside the test view.
  tiles: ["9867/8250", "9000/9000"],
  source: "OpenStreetMap contributors, ODbL",
};
const TILE = { o: [36804000, -1296000], n: 1, b: [90, 3, 10, 10, 100, 0, 0, 100] };

const fetchMock = vi.fn(async (url: string) => {
  const path = new URL(url).pathname;
  if (path === "/buildings") return { ok: true, status: 200, json: async () => INDEX };
  if (path.startsWith("/buildings/")) return { ok: true, status: 200, json: async () => TILE };
  return { ok: false, status: 404, json: async () => ({ error: "nope" }) };
});

const paths = () => fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
const viewAt = (zoom: number) => ({
  zoom,
  getBounds: () => [36.815, -1.295, 36.825, -1.285],
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  registeredLayers.clear();
  resetBuildingsData();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BuildingsLayer", () => {
  it("fetches the index but no tiles below street zoom", async () => {
    viewportRef.current = viewAt(BUILDINGS_MIN_ZOOM - 1);
    render(<BuildingsLayer />);

    await waitFor(() => expect(getBuildingsStatus()).toBe("ready"));
    expect(paths()).toEqual(["/buildings"]);
    expect(registeredLayers.get("buildings")).toEqual([]);
  });

  it("fetches only the tiles in view at street zoom and extrudes them", async () => {
    viewportRef.current = viewAt(15);
    render(<BuildingsLayer />);

    await waitFor(() => expect(registeredLayers.get("buildings")).toHaveLength(1));
    expect(paths()).toEqual(["/buildings", "/buildings/14/9867/8250"]);

    const [layer] = registeredLayers.get("buildings") as LayerLike[];
    expect(layer.props.id).toBe("buildings-9867/8250");
    expect(layer.props.extruded).toBe(true);
    expect(layer.props.pickable).toBe(false);
    const [building] = layer.props.data as { height: number; polygon: number[] }[];
    expect(building.height).toBe(9);
    expect(building.polygon).toHaveLength(6);
    const color = layer.props.getFillColor as number[];
    expect(color[3]).toBeGreaterThan(0);
    expect(color[3]).toBeLessThan(255);
  });

  it("reuses the index and tiles when remounted (toggled off and on)", async () => {
    viewportRef.current = viewAt(15);
    const first = render(<BuildingsLayer />);
    await waitFor(() => expect(registeredLayers.get("buildings")).toHaveLength(1));
    first.unmount();

    registeredLayers.clear();
    render(<BuildingsLayer />);
    await waitFor(() => expect(registeredLayers.get("buildings")).toHaveLength(1));
    expect(paths()).toEqual(["/buildings", "/buildings/14/9867/8250"]);
  });

  it("reports unavailable and draws nothing when the simulator has no data", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "No building data" }),
    }));
    viewportRef.current = viewAt(15);
    render(<BuildingsLayer />);

    await waitFor(() => expect(getBuildingsStatus()).toBe("unavailable"));
    expect(paths()).toEqual(["/buildings"]);
    expect(registeredLayers.get("buildings")).toEqual([]);
  });
});

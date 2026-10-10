import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/** The props deck.gl was last rendered with: the picker's camera and layers. */
const { deck } = vi.hoisted(() => ({
  deck: { props: null as null | Record<string, unknown> },
}));

vi.mock("@deck.gl/react", () => ({
  default: (props: Record<string, unknown>) => {
    deck.props = props;
    return <div data-testid="deck" />;
  },
}));

import { libraryBody, makeMap, mockMapsServer, type Reply } from "@/test/mocks/mapsServer";
import {
  clearAreaDraft,
  getAreaDraft,
  previewArea,
  selectArea,
  setResolvedExtract,
} from "../areaDraft";
import { bboxAreaKm2 } from "../bbox";
import type { Bbox, MapLibrary } from "../mapsClient";
import { parseMapList } from "../mapsClient";
import { BASEMAP_URL, resetPickerData } from "./basemap";
import { OPENING_MAX_ZOOM, type PickerViewState, projectLngLat, viewForBbox } from "./geometry";
import PickerMap from "./PickerMap";

const SIZE = { width: 800, height: 600 };
const NAIROBI: Bbox = [36.7, -1.4, 37.0, -1.2];
const BERGAMO: Bbox = [9.64, 45.68, 9.7, 45.71];

const COUNTRIES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Italy", label: [12.1, 42.8], minZoom: 1.7 },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [6.6, 36.6],
              [18.6, 36.6],
              [18.6, 47.1],
              [6.6, 47.1],
              [6.6, 36.6],
            ],
          ],
        ],
      },
    },
  ],
};

const RING = [
  [6.6, 43.7],
  [10.5, 43.7],
  [10.5, 46.6],
  [6.6, 46.6],
  [6.6, 43.7],
];
const OUTLINES = {
  regions: [
    { path: "europe", name: "Europe", depth: 0, polygons: [[RING]] },
    { path: "europe/italy/nord-ovest", name: "Nord-Ovest", depth: 2, polygons: [[RING]] },
  ],
  attribution: "Geofabrik",
};

function serve(regions: Reply = { body: OUTLINES }) {
  mockMapsServer({ "GET /maps/geofabrik/regions": regions });
  const apiFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input) === BASEMAP_URL) {
      return { ok: true, status: 200, json: async () => COUNTRIES } as Response;
    }
    return apiFetch(input, init);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const library = parseMapList(
  libraryBody([makeMap({ id: "nairobi", label: "Nairobi", bbox: NAIROBI })], "nairobi")
) as MapLibrary;

function view(): PickerViewState & { transitionDuration?: number } {
  return deck.props?.viewState as PickerViewState;
}

function layer(id: string) {
  const layers = (deck.props?.layers ?? []) as { id: string; props: Record<string, unknown> }[];
  return layers.find((l) => l.id === id)?.props;
}

/** Drags `el` between two screen points (the canvas sits at 0,0 in jsdom). */
function drag(el: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

function renderPicker(maxAreaKm2: number | null = 2500, lib: MapLibrary | null = null) {
  return render(<PickerMap library={lib} maxAreaKm2={maxAreaKm2} size={SIZE} />);
}

beforeEach(() => {
  deck.props = null;
  resetPickerData();
  act(() => clearAreaDraft());
});

describe("PickerMap", () => {
  it("lazy-loads the world basemap and opens on the active map at country scale", async () => {
    const fetchMock = serve();
    renderPicker(2500, library);
    expect(fetchMock).toHaveBeenCalledWith(BASEMAP_URL);
    await waitFor(() => expect(layer("picker-countries")?.data).toHaveLength(1));
    expect(layer("picker-country-labels")).toBeDefined();
    const expected = viewForBbox(NAIROBI, SIZE.width, SIZE.height, 120, OPENING_MAX_ZOOM);
    expect(expected.zoom).toBe(OPENING_MAX_ZOOM);
    expect(view().longitude).toBeCloseTo(expected.longitude, 6);
    expect(view().zoom).toBeCloseTo(OPENING_MAX_ZOOM, 6);
    expect(screen.getByText("Search a place to see it here.")).toBeInTheDocument();
    expect(screen.getByTestId("map-attribution")).toHaveTextContent(
      "Natural Earth, Geofabrik, © OpenStreetMap contributors"
    );
  });

  it("shows a previewed place, outline and extent, and flies to it", async () => {
    serve();
    renderPicker();
    await waitFor(() => expect(view()).toBeDefined());
    const outline = [
      [
        [
          [9.65, 45.69],
          [9.69, 45.69],
          [9.69, 45.7],
          [9.65, 45.69],
        ],
      ],
    ] as [number, number][][][];
    act(() => previewArea({ bbox: BERGAMO, outline }));
    const fly = viewForBbox(BERGAMO, SIZE.width, SIZE.height, 64);
    expect(view().longitude).toBeCloseTo(fly.longitude, 6);
    expect(view().zoom).toBeCloseTo(fly.zoom, 6);
    expect(view().transitionDuration).toBe(800);
    expect(layer("picker-place")?.data).toEqual([{ polygon: outline[0] }]);
    expect(layer("picker-place-extent")?.data).toHaveLength(1);
    // A preview is not a choice: no box yet.
    expect(layer("picker-box")).toBeUndefined();
  });

  it("draws the chosen box and highlights the extract it is cut from", async () => {
    serve();
    renderPicker();
    await waitFor(() => expect(layer("picker-countries")).toBeDefined());
    act(() => selectArea(BERGAMO));
    expect(layer("picker-box")?.data).toEqual([
      {
        polygon: [
          [9.64, 45.68],
          [9.7, 45.68],
          [9.7, 45.71],
          [9.64, 45.71],
          [9.64, 45.68],
        ],
      },
    ]);
    expect(layer("picker-extract")).toBeUndefined();
    act(() => setResolvedExtract({ selected: "europe/italy/nord-ovest" }));
    await waitFor(() => expect(layer("picker-extract")?.data).toEqual([{ polygon: [RING] }]));
  });

  it.each([11, 13])("resizes and moves the box in world coordinates at zoom %d", async (zoom) => {
    serve();
    renderPicker();
    act(() => selectArea(BERGAMO));
    await waitFor(() => expect(view()).toBeDefined());
    const onViewStateChange = deck.props?.onViewStateChange as (p: unknown) => void;
    act(() =>
      onViewStateChange({
        viewState: { longitude: 9.67, latitude: 45.695, zoom, pitch: 0, bearing: 0 },
      })
    );
    const v = view();
    const ne = projectLngLat(v, 800, 600, [BERGAMO[2], BERGAMO[3]]);
    const newNe = projectLngLat(v, 800, 600, [9.72, 45.72]);
    drag(screen.getByTestId("picker-handle-ne"), ne, newNe);
    let [w, s, e, n] = getAreaDraft().bbox as Bbox;
    const px = 360 / (512 * 2 ** zoom); // about one screen pixel, in degrees
    expect([w, s]).toEqual([9.64, 45.68]);
    expect(Math.abs(e - 9.72)).toBeLessThan(px);
    expect(Math.abs(n - 45.72)).toBeLessThan(px);

    const start = projectLngLat(v, 800, 600, [9.68, 45.7]);
    const end = projectLngLat(v, 800, 600, [9.69, 45.705]);
    drag(screen.getByTestId("picker-move"), start, end);
    [w, s, e, n] = getAreaDraft().bbox as Bbox;
    expect(Math.abs(w - 9.65)).toBeLessThan(px);
    expect(Math.abs(s - 45.685)).toBeLessThan(px);
    expect(e - w).toBeCloseTo(0.08, 4);
    // Adjusting is not a new place: no flight.
    expect(view().longitude).toBeCloseTo(9.67, 6);
  });

  it("only lets the box grow up to the area cap", async () => {
    serve();
    renderPicker(100);
    act(() => selectArea(BERGAMO));
    await waitFor(() => expect(view()).toBeDefined());
    const v = view();
    const se = projectLngLat(v, 800, 600, [BERGAMO[2], BERGAMO[1]]);
    // Far past 100 km².
    const far = projectLngLat(v, 800, 600, [9.85, 45.6]);
    drag(screen.getByTestId("picker-handle-se"), se, far);
    const box = getAreaDraft().bbox as Bbox;
    expect(bboxAreaKm2(box)).toBeLessThanOrEqual(100);
    expect(box).toEqual(BERGAMO);
  });

  it("degrades to countries only when the Geofabrik outlines fail", async () => {
    serve({ status: 503, body: { error: "The Geofabrik index is unavailable" } });
    renderPicker();
    expect(
      await screen.findByText("Geofabrik extracts are unavailable; showing countries only.")
    ).toBeInTheDocument();
    await waitFor(() => expect(layer("picker-countries")?.data).toHaveLength(1));
    act(() => setResolvedExtract({ selected: "europe/italy/nord-ovest" }));
    expect(layer("picker-extract")).toBeUndefined();
    expect(screen.getByTestId("map-attribution")).toHaveTextContent(
      "Natural Earth, © OpenStreetMap contributors"
    );
  });
});

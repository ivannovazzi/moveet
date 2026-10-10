import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, { props: Record<string, unknown> }[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: { props: Record<string, unknown> }[]) => {
    registeredLayers.set(id, layers);
  },
}));

// unproject: pixel [x, y] -> [x / 100, -y / 100], so dragging right and down
// grows east and south.
const viewport = {
  unproject: ([x, y]: [number, number]) => [x / 100, -y / 100],
};
vi.mock("@/components/Map/hooks", () => ({
  useMapContext: () => ({ viewport }),
}));

import { getAreaDraft, setDraftArea, setDrawing } from "@/Maps/areaDraft";
import MapAreaLayer from "./MapAreaLayer";

function boxLayer() {
  return registeredLayers.get("map-area")?.[0]?.props;
}

function drag(sheet: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(sheet, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(sheet, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(sheet, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

beforeEach(() => {
  registeredLayers.clear();
  act(() => setDraftArea(null, null));
});

describe("MapAreaLayer", () => {
  it("draws nothing without an area", () => {
    render(<MapAreaLayer />);
    expect(registeredLayers.get("map-area")).toEqual([]);
    expect(screen.queryByTestId("map-area-sheet")).toBeNull();
  });

  it("previews the chosen area as a box", () => {
    render(<MapAreaLayer />);
    act(() => setDraftArea([1, 2, 3, 4], "preset"));
    const data = boxLayer()?.data as { polygon: [number, number][] }[];
    expect(data[0].polygon).toEqual([
      [1, 2],
      [3, 2],
      [3, 4],
      [1, 4],
      [1, 2],
    ]);
  });

  it("turns a drag into the area and leaves draw mode", () => {
    render(<MapAreaLayer />);
    act(() => setDrawing(true));
    const sheet = screen.getByRole("application");
    drag(sheet, [100, 100], [300, 250]);
    expect(getAreaDraft()).toEqual({ drawing: false, bbox: [1, -2.5, 3, -1], origin: "draw" });
    expect(screen.queryByRole("application")).toBeNull();
  });

  it("keeps a drag whose events all land before a re-render", () => {
    render(<MapAreaLayer />);
    act(() => setDrawing(true));
    const sheet = screen.getByRole("application");
    act(() => {
      for (const [type, x, y] of [
        ["pointerdown", 0, 0],
        ["pointermove", 100, 100],
        ["pointerup", 200, 100],
      ] as const) {
        sheet.dispatchEvent(
          new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
        );
      }
    });
    expect(getAreaDraft().bbox).toEqual([0, -1, 2, -0]);
  });

  it("ignores a click: a box needs a drag", () => {
    render(<MapAreaLayer />);
    act(() => setDrawing(true));
    drag(screen.getByRole("application"), [100, 100], [102, 101]);
    expect(getAreaDraft()).toMatchObject({ drawing: true, bbox: null });
  });

  it("cancels on Escape without letting the key reach the app", () => {
    const appHandler = vi.fn();
    window.addEventListener("keydown", appHandler);
    render(<MapAreaLayer />);
    act(() => setDraftArea([1, 2, 3, 4], "draw"));
    act(() => setDrawing(true));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(getAreaDraft()).toMatchObject({ drawing: false, bbox: [1, 2, 3, 4] });
    expect(appHandler).not.toHaveBeenCalled();
    window.removeEventListener("keydown", appHandler);
  });
});

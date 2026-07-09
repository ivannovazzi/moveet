import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { Heatzone, Position } from "@/types";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";

// ── Capture registered layers by id ────────────────────────────────
const { registeredLayers } = vi.hoisted(() => ({
  registeredLayers: new Map<string, unknown[]>(),
}));

vi.mock("@/components/Map/hooks/useDeckLayers", () => ({
  useRegisterLayers: (id: string, layers: unknown[]) => {
    registeredLayers.set(id, layers);
  },
}));

// ── Mock viewport / overlay ────────────────────────────────────────
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

// ── Mock heatzone data + editor context ────────────────────────────
let heatzones: Heatzone[] = [];
vi.mock("@/hooks/useHeatzones", () => ({
  useHeatzones: () => heatzones,
}));

let editor: HeatzoneEditor;
vi.mock("@/data/HeatzoneEditorContext", () => ({
  useHeatzoneEditorContext: () => editor,
}));

import Heatzones from "./TrafficZones";

function makeEditor(overrides: Partial<HeatzoneEditor> = {}): HeatzoneEditor {
  return {
    mode: "idle",
    isDrawing: false,
    selectedId: null,
    draft: null,
    startDraw: vi.fn(),
    stopDraw: vi.fn(),
    toggleDraw: vi.fn(),
    select: vi.fn(),
    deselect: vi.fn(),
    createFromLasso: vi.fn().mockResolvedValue(undefined),
    setDraft: vi.fn(),
    clearDraft: vi.fn(),
    commitGeometry: vi.fn().mockResolvedValue(undefined),
    setIntensity: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    clearAll: vi.fn().mockResolvedValue(undefined),
    seed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ZONE: Heatzone = {
  type: "Feature",
  properties: {
    id: "hz-1",
    intensity: 0.5,
    timestamp: "2026-01-01T00:00:00Z",
    radius: 500,
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ] as Position[],
  },
};

function down(x: number, y: number) {
  mapEl.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
    })
  );
}
function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
}
function up(x: number, y: number) {
  window.dispatchEvent(
    new MouseEvent("mouseup", {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
    })
  );
}
function clickAt(x: number, y: number) {
  mapEl.dispatchEvent(
    new MouseEvent("click", {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
    })
  );
}

beforeEach(() => {
  registeredLayers.clear();
  heatzones = [];
  editor = makeEditor();
});

describe("Heatzones display layer", () => {
  it("registers a pickable traffic-zones PolygonLayer with one datum per zone", () => {
    heatzones = [ZONE];
    render(<Heatzones visible />);
    const layers = registeredLayers.get("traffic-zones")!;
    expect(layers.length).toBe(1);
    const layer = layers[0] as {
      props: { id: string; pickable: boolean; data: unknown[] };
    };
    expect(layer.props.id).toBe("traffic-zones");
    expect(layer.props.pickable).toBe(true);
    expect(layer.props.data.length).toBe(1);
  });

  it("registers no display layer when hidden", () => {
    heatzones = [ZONE];
    render(<Heatzones visible={false} />);
    expect(registeredLayers.get("traffic-zones")).toEqual([]);
  });
});

describe("Heatzones vertex handles", () => {
  it("renders vertex handles plus a center move handle for the selected zone", () => {
    heatzones = [ZONE];
    editor = makeEditor({ mode: "selected", selectedId: "hz-1" });
    render(<Heatzones visible />);
    const handles = registeredLayers.get("heatzone-handles")! as {
      props: { id: string; data: unknown[]; pickable: boolean };
    }[];
    expect(handles.length).toBe(2);
    const vertexLayer = handles.find((l) => l.props.id === "heatzone-handles")!;
    const moveLayer = handles.find((l) => l.props.id === "heatzone-move-handle")!;
    // one handle per unique vertex of the selected ring
    expect(vertexLayer.props.data.length).toBe(ZONE.geometry.coordinates.length);
    // a single center move handle
    expect(moveLayer.props.data.length).toBe(1);
  });

  it("renders no handles when nothing is selected", () => {
    heatzones = [ZONE];
    render(<Heatzones visible />);
    expect(registeredLayers.get("heatzone-handles")).toEqual([]);
  });
});

describe("Heatzones lasso draw", () => {
  it("builds a draw-preview layer while a stroke is in progress and commits on release", () => {
    editor = makeEditor({ mode: "draw", isDrawing: true });
    render(<Heatzones visible />);

    act(() => {
      down(10, 10);
      move(20, 20);
      move(30, 10);
    });
    // preview path present mid-stroke
    const preview = registeredLayers.get("heatzone-draw")!;
    expect(preview.length).toBeGreaterThan(0);

    act(() => {
      up(30, 10);
    });
    expect(editor.createFromLasso).toHaveBeenCalledTimes(1);
    const path = vi.mocked(editor.createFromLasso).mock.calls[0][0];
    // collected geo points = pixel/100
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path[0]).toEqual([0.1, 0.1]);
  });
});

describe("Heatzones suppressNextClick", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function armViaDraw() {
    editor = makeEditor({ mode: "draw", isDrawing: true });
    render(<Heatzones visible />);
    // A draw gesture arms the click suppressor on mouseup.
    act(() => {
      down(10, 10);
      up(10, 10);
    });
  }

  function clickPrevented(): boolean {
    const ev = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      window.dispatchEvent(ev);
    });
    return ev.defaultPrevented;
  }

  it("swallows a click on the same tick exactly once", () => {
    armViaDraw();
    expect(clickPrevented()).toBe(true); // the drag's synthetic click is eaten
    expect(clickPrevented()).toBe(false); // a subsequent click passes through
  });

  it("does not swallow a click on a later tick (suppressor auto-expires)", () => {
    armViaDraw();
    act(() => {
      vi.runAllTimers(); // no click arrived; the suppressor expires next tick
    });
    expect(clickPrevented()).toBe(false);
  });

  it("does not leak listeners when armed repeatedly", () => {
    armViaDraw();
    // Arm a second time before any click consumes the first suppressor.
    act(() => {
      down(12, 12);
      up(12, 12);
    });
    expect(clickPrevented()).toBe(true); // only one suppressor is active
    expect(clickPrevented()).toBe(false);
    act(() => {
      vi.runAllTimers();
    });
    expect(clickPrevented()).toBe(false); // nothing lingering
  });
});

describe("Heatzones reshape", () => {
  it("drafts on drag-move and commits geometry once on release (not per move)", () => {
    heatzones = [ZONE];
    editor = makeEditor({ mode: "selected", selectedId: "hz-1" });
    render(<Heatzones visible />);

    // first handle projects to pixel (10,10)
    act(() => {
      down(10, 10);
      move(15, 15);
      move(18, 18);
    });
    expect(editor.setDraft).toHaveBeenCalled();
    expect(editor.commitGeometry).not.toHaveBeenCalled();

    act(() => {
      up(18, 18);
    });
    expect(editor.commitGeometry).toHaveBeenCalledTimes(1);
    const [id, coords] = vi.mocked(editor.commitGeometry).mock.calls[0];
    expect(id).toBe("hz-1");
    // dragged vertex 0 moved to unproject(18,18) = [0.18,0.18]
    expect(coords[0]).toEqual([0.18, 0.18]);
  });
});

// A larger zone so interior points are clear of every vertex-handle radius.
const BIG_ZONE: Heatzone = {
  type: "Feature",
  properties: {
    id: "hz-big",
    intensity: 0.5,
    timestamp: "2026-01-01T00:00:00Z",
    radius: 500,
  },
  geometry: {
    type: "Polygon",
    // projects to (0,0)(100,0)(100,100)(0,100); centroid -> pixel (50,50)
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as Position[],
  },
};

describe("Heatzones move / body passthrough", () => {
  it("moves the whole zone when dragging the center handle", () => {
    heatzones = [BIG_ZONE];
    editor = makeEditor({ mode: "selected", selectedId: "hz-big" });
    render(<Heatzones visible />);

    // Center handle sits at pixel (50,50); grab and drag it by +10px.
    act(() => {
      down(50, 50);
      move(60, 60);
    });
    expect(editor.setDraft).toHaveBeenCalled();

    act(() => {
      up(60, 60);
    });
    expect(editor.commitGeometry).toHaveBeenCalledTimes(1);
    const [id, coords] = vi.mocked(editor.commitGeometry).mock.calls[0];
    expect(id).toBe("hz-big");
    // every vertex translated by unproject(+10px) = +0.1 deg
    expect(coords[0][0]).toBeCloseTo(0.1);
    expect(coords[0][1]).toBeCloseTo(0.1);
  });

  it("does NOT capture a press on the zone body (away from handles) - deck pans/picks it", () => {
    heatzones = [BIG_ZONE];
    editor = makeEditor({ mode: "selected", selectedId: "hz-big" });
    render(<Heatzones visible />);

    // (50,20): inside the polygon but far from every vertex and the center handle.
    act(() => {
      down(50, 20);
      move(60, 30);
      up(60, 30);
    });
    expect(editor.setDraft).not.toHaveBeenCalled();
    expect(editor.commitGeometry).not.toHaveBeenCalled();
  });
});

describe("Heatzones selection (plain click, non-hijacking)", () => {
  it("selects the zone under a plain click", () => {
    heatzones = [BIG_ZONE];
    render(<Heatzones visible />); // idle
    act(() => clickAt(50, 50)); // inside BIG_ZONE (projects to geo [0.5,0.5])
    expect(editor.select).toHaveBeenCalledWith("hz-big");
  });

  it("deselects when clicking empty map", () => {
    heatzones = [BIG_ZONE];
    editor = makeEditor({ mode: "selected", selectedId: "hz-big" });
    render(<Heatzones visible />);
    act(() => clickAt(500, 500)); // geo [5,5] - outside the zone
    expect(editor.deselect).toHaveBeenCalledTimes(1);
  });

  it("does not (de)select while drawing", () => {
    heatzones = [BIG_ZONE];
    editor = makeEditor({ mode: "draw", isDrawing: true });
    render(<Heatzones visible />);
    act(() => clickAt(50, 50));
    expect(editor.select).not.toHaveBeenCalled();
    expect(editor.deselect).not.toHaveBeenCalled();
  });
});

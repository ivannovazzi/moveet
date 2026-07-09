import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Heatzone, Position } from "@/types";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";

let editor: HeatzoneEditor;
vi.mock("@/data/HeatzoneEditorContext", () => ({
  useHeatzoneEditorContext: () => editor,
}));

let heatzones: Heatzone[] = [];
vi.mock("@/hooks/useHeatzones", () => ({
  useHeatzones: () => heatzones,
}));

import HeatzoneInspector from "./HeatzoneInspector";

const ZONE: Heatzone = {
  type: "Feature",
  properties: { id: "hz-1", intensity: 0.5, timestamp: "2026-01-01T00:00:00Z", radius: 500 },
  geometry: {
    type: "Polygon",
    coordinates: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ] as Position[],
  },
};

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

beforeEach(() => {
  heatzones = [ZONE];
  editor = makeEditor();
});

describe("HeatzoneInspector", () => {
  it("renders nothing when no zone is selected", () => {
    const { container } = render(<HeatzoneInspector />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the intensity control and delete for the selected zone", () => {
    editor = makeEditor({ mode: "selected", selectedId: "hz-1" });
    render(<HeatzoneInspector />);
    expect(screen.getByRole("slider", { name: /intensity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("pushes intensity changes to the editor", () => {
    editor = makeEditor({ mode: "selected", selectedId: "hz-1" });
    render(<HeatzoneInspector />);
    const slider = screen.getByRole("slider", { name: /intensity/i });
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(editor.setIntensity).toHaveBeenCalledWith("hz-1", expect.any(Number));
  });

  it("deletes the selected zone", async () => {
    editor = makeEditor({ mode: "selected", selectedId: "hz-1" });
    const user = userEvent.setup();
    render(<HeatzoneInspector />);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(editor.remove).toHaveBeenCalledWith("hz-1");
  });
});

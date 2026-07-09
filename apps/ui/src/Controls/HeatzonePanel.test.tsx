import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Heatzone } from "@/types";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";

let editor: HeatzoneEditor;
let zones: Heatzone[];

vi.mock("@/data/HeatzoneEditorContext", () => ({
  useHeatzoneEditorContext: () => editor,
}));
vi.mock("@/hooks/useHeatzones", () => ({
  useHeatzones: () => zones,
}));

import HeatzonePanel from "./HeatzonePanel";

function makeEditor(overrides: Partial<HeatzoneEditor> = {}): HeatzoneEditor {
  return {
    mode: "idle",
    isDrawing: false,
    selectedId: null,
    draft: null,
    seedNonce: 0,
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

function zone(id: string, intensity: number): Heatzone {
  return {
    type: "Feature",
    properties: { id, intensity, timestamp: "2026-01-01T00:00:00Z", radius: 1 },
    geometry: { type: "Polygon", coordinates: [] },
  };
}

beforeEach(() => {
  editor = makeEditor();
  zones = [];
  vi.restoreAllMocks();
});

describe("HeatzonePanel", () => {
  it("starts drawing from the Draw button", async () => {
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /draw zone/i }));
    expect(editor.startDraw).toHaveBeenCalledTimes(1);
  });

  it("shows a Done control while drawing and stops on click", async () => {
    editor = makeEditor({ mode: "draw", isDrawing: true });
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(editor.stopDraw).toHaveBeenCalledTimes(1);
  });

  it("seeds random zones", async () => {
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /seed random/i }));
    expect(editor.seed).toHaveBeenCalledTimes(1);
  });

  it("disables Clear all when there are no zones", () => {
    render(<HeatzonePanel />);
    expect(screen.getByRole("button", { name: /clear all/i })).toBeDisabled();
  });

  it("clears all zones after confirmation", async () => {
    zones = [zone("hz-1", 0.5)];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(editor.clearAll).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the confirmation is dismissed", async () => {
    zones = [zone("hz-1", 0.5)];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(editor.clearAll).not.toHaveBeenCalled();
  });

  it("lists zones and selects one on row click", async () => {
    zones = [zone("hz-1", 0.4), zone("hz-2", 0.8)];
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    expect(screen.getByText("Heat zone 1")).toBeInTheDocument();
    expect(screen.getByText("80% intensity")).toBeInTheDocument();
    await user.click(screen.getByText("Heat zone 2"));
    expect(editor.select).toHaveBeenCalledWith("hz-2");
  });

  it("deletes a zone from its row", async () => {
    zones = [zone("hz-1", 0.4)];
    const user = userEvent.setup();
    render(<HeatzonePanel />);
    await user.click(screen.getByRole("button", { name: /delete heat zone 1/i }));
    expect(editor.remove).toHaveBeenCalledWith("hz-1");
  });

  it("shows an empty state with no zones", () => {
    render(<HeatzonePanel />);
    expect(screen.getByText(/no heat zones/i)).toBeInTheDocument();
  });
});

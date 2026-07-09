import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";

let editor: HeatzoneEditor;
vi.mock("@/data/HeatzoneEditorContext", () => ({
  useHeatzoneEditorContext: () => editor,
}));

import ZonesGroup from "./ZonesGroup";

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
  editor = makeEditor();
  vi.restoreAllMocks();
});

describe("ZonesGroup", () => {
  it("toggles draw mode", async () => {
    const user = userEvent.setup();
    render(<ZonesGroup />);
    await user.click(screen.getByRole("button", { name: /draw/i }));
    expect(editor.toggleDraw).toHaveBeenCalledTimes(1);
  });

  it("seeds random zones", async () => {
    const user = userEvent.setup();
    render(<ZonesGroup />);
    await user.click(screen.getByRole("button", { name: /seed/i }));
    expect(editor.seed).toHaveBeenCalledTimes(1);
  });

  it("clears all zones after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<ZonesGroup />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(editor.clearAll).toHaveBeenCalledTimes(1);
  });

  it("does not clear when the confirmation is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<ZonesGroup />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(editor.clearAll).not.toHaveBeenCalled();
  });

  it("marks the draw button active while drawing", () => {
    editor = makeEditor({ mode: "draw", isDrawing: true });
    render(<ZonesGroup />);
    expect(screen.getByRole("button", { name: /draw/i })).toHaveAttribute("aria-pressed", "true");
  });
});

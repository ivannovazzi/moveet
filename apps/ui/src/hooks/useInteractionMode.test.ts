import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import {
  useInteractionMode,
  useInteractionKeyboard,
  keyActionFor,
  type GlobalKeyContext,
  type GlobalKeyHandlers,
} from "./useInteractionMode";

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "@/lib/toast";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useInteractionMode", () => {
  it("starts in browse", () => {
    const { result } = renderHook(() => useInteractionMode({ replayActive: false }));
    expect(result.current.mode).toEqual({ kind: "browse" });
  });

  it("enters and exits dispatch", () => {
    const { result } = renderHook(() => useInteractionMode({ replayActive: false }));

    act(() => result.current.enterDispatch());
    expect(result.current.mode).toEqual({ kind: "dispatch" });

    act(() => result.current.exitToBrowse());
    expect(result.current.mode).toEqual({ kind: "browse" });
  });

  it("modes are mutually exclusive — entering one exits the other", () => {
    const { result } = renderHook(() => useInteractionMode({ replayActive: false }));

    act(() => result.current.enterDispatch());
    act(() => result.current.enterDrawGeofence());
    expect(result.current.mode).toEqual({ kind: "draw-geofence" });

    act(() => result.current.enterDispatch());
    expect(result.current.mode).toEqual({ kind: "dispatch" });
  });

  it("refuses to enter dispatch or draw while a replay is active", () => {
    const { result } = renderHook(() => useInteractionMode({ replayActive: true }));

    act(() => result.current.enterDispatch());
    expect(result.current.mode).toEqual({ kind: "browse" });

    act(() => result.current.enterDrawGeofence());
    expect(result.current.mode).toEqual({ kind: "browse" });

    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("force-exits the active mode when a replay starts", () => {
    const { result, rerender } = renderHook(
      ({ replayActive }: { replayActive: boolean }) => useInteractionMode({ replayActive }),
      { initialProps: { replayActive: false } }
    );

    act(() => result.current.enterDrawGeofence());
    expect(result.current.mode).toEqual({ kind: "draw-geofence" });

    rerender({ replayActive: true });
    expect(result.current.mode).toEqual({ kind: "browse" });
  });
});

describe("keyActionFor", () => {
  const ctx = (overrides: Partial<GlobalKeyContext> = {}): GlobalKeyContext => ({
    modeKind: "browse",
    canConfirmDraw: false,
    canSubmitDispatch: false,
    hasSelection: false,
    panelOpen: false,
    ...overrides,
  });

  it("routes Escape by priority: draw > dispatch > selection > panel > none", () => {
    // Draw wins even with everything else active.
    expect(
      keyActionFor(
        "Escape",
        ctx({ modeKind: "draw-geofence", hasSelection: true, panelOpen: true })
      )
    ).toBe("cancel-draw");
    expect(
      keyActionFor("Escape", ctx({ modeKind: "dispatch", hasSelection: true, panelOpen: true }))
    ).toBe("exit-dispatch");
    expect(keyActionFor("Escape", ctx({ hasSelection: true, panelOpen: true }))).toBe(
      "clear-selection"
    );
    expect(keyActionFor("Escape", ctx({ panelOpen: true }))).toBe("close-panel");
    expect(keyActionFor("Escape", ctx())).toBe("none");
  });

  it("routes Enter to the active mode, gated on readiness", () => {
    expect(keyActionFor("Enter", ctx({ modeKind: "draw-geofence", canConfirmDraw: true }))).toBe(
      "confirm-draw"
    );
    expect(keyActionFor("Enter", ctx({ modeKind: "draw-geofence", canConfirmDraw: false }))).toBe(
      "none"
    );
    expect(keyActionFor("Enter", ctx({ modeKind: "dispatch", canSubmitDispatch: true }))).toBe(
      "submit-dispatch"
    );
    expect(keyActionFor("Enter", ctx({ modeKind: "dispatch", canSubmitDispatch: false }))).toBe(
      "none"
    );
    expect(keyActionFor("Enter", ctx({ canConfirmDraw: true, canSubmitDispatch: true }))).toBe(
      "none"
    );
  });

  it("ignores other keys", () => {
    expect(keyActionFor("a", ctx({ modeKind: "dispatch", hasSelection: true }))).toBe("none");
    expect(keyActionFor("Tab", ctx({ modeKind: "draw-geofence" }))).toBe("none");
  });
});

describe("useInteractionKeyboard", () => {
  const makeHandlers = (): GlobalKeyHandlers => ({
    onCancelDraw: vi.fn(),
    onConfirmDraw: vi.fn(),
    onExitDispatch: vi.fn(),
    onSubmitDispatch: vi.fn(),
    onClearSelection: vi.fn(),
    onClosePanel: vi.fn(),
  });

  const baseCtx: GlobalKeyContext = {
    modeKind: "dispatch",
    canConfirmDraw: false,
    canSubmitDispatch: false,
    hasSelection: false,
    panelOpen: false,
  };

  it("fires the routed handler on a window-level keydown", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onExitDispatch).toHaveBeenCalledOnce();
    expect(handlers.onCancelDraw).not.toHaveBeenCalled();
    expect(handlers.onClearSelection).not.toHaveBeenCalled();
  });

  it("tracks context changes across rerenders without resubscribing", () => {
    const handlers = makeHandlers();
    const { rerender } = renderHook(
      ({ ctx }: { ctx: GlobalKeyContext }) => useInteractionKeyboard(ctx, handlers),
      { initialProps: { ctx: baseCtx } }
    );

    rerender({ ctx: { ...baseCtx, modeKind: "draw-geofence" } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onCancelDraw).toHaveBeenCalledOnce();
    expect(handlers.onExitDispatch).not.toHaveBeenCalled();
  });

  it("does not intercept keys typed into form fields", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    input.remove();

    expect(handlers.onExitDispatch).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onExitDispatch).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import {
  useInteractionMode,
  useInteractionKeyboard,
  keyActionFor,
  type GlobalKeyContext,
  type GlobalKeyHandlers,
  type InteractionMode,
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

  describe("derived modes (job placement, heat zones)", () => {
    const setup = (initial: InteractionMode | null = null) => {
      const onExitDerived = vi.fn();
      const utils = renderHook(
        ({ derived }: { derived: InteractionMode | null }) =>
          useInteractionMode({ replayActive: false, derived, onExitDerived }),
        { initialProps: { derived: initial } }
      );
      return { ...utils, onExitDerived };
    };

    it("reports the derived mode as the active one", () => {
      const { result } = setup({ kind: "place-job" });
      expect(result.current.mode).toEqual({ kind: "place-job" });
    });

    it("a derived mode outranks an owned one, and drops it", () => {
      const { result, rerender } = setup();

      act(() => result.current.enterDispatch());
      expect(result.current.mode).toEqual({ kind: "dispatch" });

      rerender({ derived: { kind: "draw-heatzone" } });
      expect(result.current.mode).toEqual({ kind: "draw-heatzone" });

      // …and the owned mode is gone underneath, not merely hidden.
      rerender({ derived: null });
      expect(result.current.mode).toEqual({ kind: "browse" });
    });

    it("entering an owned mode cancels the derived one", () => {
      const { result, onExitDerived } = setup({ kind: "edit-heatzone", id: "z1" });

      act(() => result.current.enterDispatch());
      expect(onExitDerived).toHaveBeenCalledOnce();
    });

    it("exiting to browse cancels the derived one", () => {
      const { result, onExitDerived } = setup({ kind: "place-job" });

      act(() => result.current.exitToBrowse());
      expect(onExitDerived).toHaveBeenCalledOnce();
    });

    it("a replay starting cancels a derived mode too", () => {
      const onExitDerived = vi.fn();
      const { rerender } = renderHook(
        ({ replayActive }: { replayActive: boolean }) =>
          useInteractionMode({
            replayActive,
            derived: { kind: "draw-heatzone" },
            onExitDerived,
          }),
        { initialProps: { replayActive: false } }
      );

      rerender({ replayActive: true });
      expect(onExitDerived).toHaveBeenCalled();
    });
  });
});

describe("keyActionFor", () => {
  const ctx = (overrides: Partial<GlobalKeyContext> = {}): GlobalKeyContext => ({
    modeKind: "browse",
    canConfirmMode: false,
    hasSelection: false,
    panelOpen: false,
    overlayOpen: false,
    ...overrides,
  });

  it("routes Escape by priority: mode > selection > panel > none", () => {
    for (const modeKind of [
      "dispatch",
      "draw-geofence",
      "place-job",
      "draw-heatzone",
      "edit-heatzone",
    ] as const) {
      expect(keyActionFor("Escape", ctx({ modeKind, hasSelection: true, panelOpen: true }))).toBe(
        "exit-mode"
      );
    }
    expect(keyActionFor("Escape", ctx({ hasSelection: true, panelOpen: true }))).toBe(
      "clear-selection"
    );
    expect(keyActionFor("Escape", ctx({ panelOpen: true }))).toBe("close-panel");
    expect(keyActionFor("Escape", ctx())).toBe("none");
  });

  it("routes Enter to the active mode, gated on readiness", () => {
    expect(keyActionFor("Enter", ctx({ modeKind: "draw-geofence", canConfirmMode: true }))).toBe(
      "confirm-mode"
    );
    expect(keyActionFor("Enter", ctx({ modeKind: "draw-geofence", canConfirmMode: false }))).toBe(
      "none"
    );
    expect(keyActionFor("Enter", ctx({ modeKind: "dispatch", canConfirmMode: true }))).toBe(
      "confirm-mode"
    );
    // No mode active: Enter belongs to whatever has focus, not to the map.
    expect(keyActionFor("Enter", ctx({ canConfirmMode: true }))).toBe("none");
  });

  it("starts a mode from a bare shortcut, but only while browsing", () => {
    expect(keyActionFor("d", ctx())).toBe("start-mode");
    expect(keyActionFor("G", ctx())).toBe("start-mode");
    expect(keyActionFor("h", ctx())).toBe("start-mode");
    // Mid-mode a stray key must never swap the tool under the operator.
    expect(keyActionFor("g", ctx({ modeKind: "dispatch" }))).toBe("none");
    expect(keyActionFor("q", ctx())).toBe("none");
  });

  it("ignores other keys", () => {
    expect(keyActionFor("Tab", ctx({ modeKind: "draw-geofence" }))).toBe("none");
  });

  it("stands down entirely while an overlay is open (menu/dialog owns the keys)", () => {
    expect(keyActionFor("Escape", ctx({ hasSelection: true, overlayOpen: true }))).toBe("none");
    expect(keyActionFor("Escape", ctx({ modeKind: "dispatch", overlayOpen: true }))).toBe("none");
    expect(
      keyActionFor("Enter", ctx({ modeKind: "dispatch", canConfirmMode: true, overlayOpen: true }))
    ).toBe("none");
    expect(keyActionFor("d", ctx({ overlayOpen: true }))).toBe("none");
  });
});

describe("useInteractionKeyboard", () => {
  const makeHandlers = (): GlobalKeyHandlers => ({
    onExitMode: vi.fn(),
    onConfirmMode: vi.fn(),
    onClearSelection: vi.fn(),
    onClosePanel: vi.fn(),
    onStartMode: vi.fn(),
  });

  const baseCtx: GlobalKeyContext = {
    modeKind: "dispatch",
    canConfirmMode: false,
    hasSelection: false,
    panelOpen: false,
    overlayOpen: false,
  };

  it("fires the routed handler on a window-level keydown", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onExitMode).toHaveBeenCalledOnce();
    expect(handlers.onClearSelection).not.toHaveBeenCalled();
  });

  it("fires exactly one handler per press (a single Escape never unwinds two things)", () => {
    const handlers = makeHandlers();
    // Dispatch mode, a selection AND an open panel: the pre-union code had a
    // listener for each of these and unwound all three on one press.
    renderHook(() =>
      useInteractionKeyboard({ ...baseCtx, hasSelection: true, panelOpen: true }, handlers)
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onExitMode).toHaveBeenCalledOnce();
    expect(handlers.onClearSelection).not.toHaveBeenCalled();
    expect(handlers.onClosePanel).not.toHaveBeenCalled();
  });

  it("passes the shortcut's mode to onStartMode", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard({ ...baseCtx, modeKind: "browse" }, handlers));

    fireEvent.keyDown(window, { key: "j" });

    expect(handlers.onStartMode).toHaveBeenCalledWith("place-job");
  });

  it("leaves chorded keys to the browser and the command palette", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard({ ...baseCtx, modeKind: "browse" }, handlers));

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });

    expect(handlers.onStartMode).not.toHaveBeenCalled();
  });

  it("tracks context changes across rerenders without resubscribing", () => {
    const handlers = makeHandlers();
    const { rerender } = renderHook(
      ({ ctx }: { ctx: GlobalKeyContext }) => useInteractionKeyboard(ctx, handlers),
      { initialProps: { ctx: baseCtx } }
    );

    rerender({ ctx: { ...baseCtx, modeKind: "browse", hasSelection: true } });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onClearSelection).toHaveBeenCalledOnce();
    expect(handlers.onExitMode).not.toHaveBeenCalled();
  });

  it("does not clear the selection when Escape dismisses an open overlay", () => {
    const handlers = makeHandlers();
    // Selection is present and no mode is active — Escape would normally clear it.
    const overlayCtx: GlobalKeyContext = {
      ...baseCtx,
      modeKind: "browse",
      hasSelection: true,
      overlayOpen: true,
    };
    renderHook(() => useInteractionKeyboard(overlayCtx, handlers));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onClearSelection).not.toHaveBeenCalled();
    expect(handlers.onExitMode).not.toHaveBeenCalled();
  });

  it("ignores a keydown already handled (defaultPrevented) by an overlay", () => {
    const handlers = makeHandlers();
    const ctxWithSelection: GlobalKeyContext = {
      ...baseCtx,
      modeKind: "browse",
      hasSelection: true,
    };
    renderHook(() => useInteractionKeyboard(ctxWithSelection, handlers));

    // Simulate an overlay consuming the event first: a capture-phase listener
    // runs before the hook's bubble-phase listener and marks it handled.
    const consume = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", consume, { capture: true });
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", consume, { capture: true });

    expect(handlers.onClearSelection).not.toHaveBeenCalled();
  });

  it("does not intercept keys typed into form fields", () => {
    const handlers = makeHandlers();
    renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    input.remove();

    expect(handlers.onExitMode).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const handlers = makeHandlers();
    const { unmount } = renderHook(() => useInteractionKeyboard(baseCtx, handlers));

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(handlers.onExitMode).not.toHaveBeenCalled();
  });
});

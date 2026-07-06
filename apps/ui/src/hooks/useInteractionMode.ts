import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

/**
 * The map's interaction mode — exactly one is active at a time. Dispatch and
 * geofence drawing were previously independent booleans (`dispatchMode`,
 * `drawingActive`) that could both be on at once, double-handling Escape and
 * overlapping their hint banners. This union is the single source of truth.
 *
 * Replay is deliberately not folded in (it's server-driven via
 * `replayStatus.mode`), but entering dispatch/draw is refused while a replay
 * is running, and a replay starting force-exits any active mode.
 */
export type InteractionMode = { kind: "browse" } | { kind: "dispatch" } | { kind: "draw-geofence" };

export type InteractionModeKind = InteractionMode["kind"];

const BROWSE: InteractionMode = { kind: "browse" };
const DISPATCH: InteractionMode = { kind: "dispatch" };
const DRAW_GEOFENCE: InteractionMode = { kind: "draw-geofence" };

export interface InteractionModeApi {
  mode: InteractionMode;
  enterDispatch: () => void;
  enterDrawGeofence: () => void;
  exitToBrowse: () => void;
}

/**
 * Owns the interaction-mode union. Entering one mode implicitly exits the
 * other: mode-specific cleanup lives with each mode's own hook (useDispatchFlow
 * resets its flow state when its `active` flag drops; GeofenceDrawTool clears
 * its vertices when `active` drops), so a plain mode switch here is a clean
 * exit of the previous mode.
 */
export function useInteractionMode({
  replayActive,
}: {
  replayActive: boolean;
}): InteractionModeApi {
  const [mode, setMode] = useState<InteractionMode>(BROWSE);

  const enterDispatch = useCallback(() => {
    if (replayActive) {
      toast.info("Dispatch is unavailable during replay");
      return;
    }
    setMode(DISPATCH);
  }, [replayActive]);

  const enterDrawGeofence = useCallback(() => {
    if (replayActive) {
      toast.info("Zone drawing is unavailable during replay");
      return;
    }
    setMode(DRAW_GEOFENCE);
  }, [replayActive]);

  const exitToBrowse = useCallback(() => setMode(BROWSE), []);

  // A replay starting on the server force-exits any active mode.
  useEffect(() => {
    if (replayActive) setMode(BROWSE);
  }, [replayActive]);

  return { mode, enterDispatch, enterDrawGeofence, exitToBrowse };
}

// ─── Global keyboard dispatcher ─────────────────────────────────────

export type GlobalKeyAction =
  | "cancel-draw"
  | "confirm-draw"
  | "exit-dispatch"
  | "submit-dispatch"
  | "clear-selection"
  | "close-panel"
  | "none";

export interface GlobalKeyContext {
  modeKind: InteractionModeKind;
  /** Draw polygon can close (≥ 3 vertices). */
  canConfirmDraw: boolean;
  /** Dispatch is in ROUTE with at least one assignment. */
  canSubmitDispatch: boolean;
  hasSelection: boolean;
  panelOpen: boolean;
}

/**
 * Pure routing for the single window-level keyboard listener.
 *
 * Escape priority: cancel geofence draw → exit dispatch → clear selection
 * (closes the inspector) → close the active panel. Enter routes to the active
 * mode: close the draw polygon, or submit the pending dispatch.
 */
export function keyActionFor(key: string, ctx: GlobalKeyContext): GlobalKeyAction {
  if (key === "Escape") {
    if (ctx.modeKind === "draw-geofence") return "cancel-draw";
    if (ctx.modeKind === "dispatch") return "exit-dispatch";
    if (ctx.hasSelection) return "clear-selection";
    if (ctx.panelOpen) return "close-panel";
    return "none";
  }
  if (key === "Enter") {
    if (ctx.modeKind === "draw-geofence") return ctx.canConfirmDraw ? "confirm-draw" : "none";
    if (ctx.modeKind === "dispatch") return ctx.canSubmitDispatch ? "submit-dispatch" : "none";
    return "none";
  }
  return "none";
}

export interface GlobalKeyHandlers {
  onCancelDraw: () => void;
  onConfirmDraw: () => void;
  onExitDispatch: () => void;
  onSubmitDispatch: () => void;
  onClearSelection: () => void;
  onClosePanel: () => void;
}

/**
 * The app's ONE window-level keydown listener. Replaces the competing
 * listeners that used to live in useDispatchShortcuts and GeofenceDrawTool
 * (which both handled a single Escape press when dispatch and drawing were
 * active simultaneously). Context and handlers are read through refs so the
 * listener is subscribed exactly once.
 */
export function useInteractionKeyboard(ctx: GlobalKeyContext, handlers: GlobalKeyHandlers): void {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept while typing in inputs/textareas.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const action = keyActionFor(e.key, ctxRef.current);
      if (action === "none") return;
      e.preventDefault();
      const h = handlersRef.current;
      switch (action) {
        case "cancel-draw":
          h.onCancelDraw();
          break;
        case "confirm-draw":
          h.onConfirmDraw();
          break;
        case "exit-dispatch":
          h.onExitDispatch();
          break;
        case "submit-dispatch":
          h.onSubmitDispatch();
          break;
        case "clear-selection":
          h.onClearSelection();
          break;
        case "close-panel":
          h.onClosePanel();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

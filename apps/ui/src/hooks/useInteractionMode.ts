import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";

/**
 * The map's interaction mode — exactly one is active at a time. This is the
 * single answer to "what does a click on the map mean right now", and every
 * modal map tool is a member:
 *
 *  - `dispatch` and `draw-geofence` are *owned* here (their hooks derive an
 *    `active` flag from this union and clean up when it drops);
 *  - `place-job`, `draw-heatzone` and `edit-heatzone` are *derived* — those
 *    tools own richer state of their own (a two-click draft, a selected zone
 *    id), so this hook reads their state instead of duplicating it.
 *
 * Either way the union is authoritative for the dock, the mode rail and the
 * keyboard: entering an owned mode cancels a derived one and vice versa, so two
 * tools can never claim the map at once.
 *
 * Replay is deliberately not a member (it's server-driven via
 * `replayStatus.mode`), but entering any mode is refused while a replay is
 * running, and a replay starting force-exits whatever was active.
 */
export type InteractionMode =
  | { kind: "browse" }
  | { kind: "dispatch" }
  | { kind: "draw-geofence" }
  | { kind: "place-job" }
  | { kind: "draw-heatzone" }
  | { kind: "edit-heatzone"; id: string };

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

export interface UseInteractionModeOptions {
  replayActive: boolean;
  /**
   * The mode claimed by a tool that owns its own state (job placement, heat
   * zone authoring), or `null` when none is. Computed by the caller from those
   * hooks so this one never mirrors — and so can never drift from — them.
   * Optional: a caller wiring only the owned modes can leave it out.
   */
  derived?: InteractionMode | null;
  /** Cancels whichever derived mode is active. Safe to call when none is. */
  onExitDerived?: () => void;
}

const NO_DERIVED_MODE = () => {};

/**
 * Owns the interaction-mode union. Entering one mode implicitly exits the
 * other: mode-specific cleanup lives with each mode's own hook (useDispatchFlow
 * resets its flow state when its `active` flag drops; GeofenceDrawTool clears
 * its vertices when `active` drops; the derived tools are cancelled through
 * `onExitDerived`), so a plain mode switch here is a clean exit of the previous
 * mode.
 */
export function useInteractionMode({
  replayActive,
  derived = null,
  onExitDerived = NO_DERIVED_MODE,
}: UseInteractionModeOptions): InteractionModeApi {
  const [owned, setOwned] = useState<InteractionMode>(BROWSE);

  // Read through a ref so entering a mode doesn't have to re-memoize every time
  // the caller rebuilds its cancel closure.
  const exitDerivedRef = useRef(onExitDerived);
  exitDerivedRef.current = onExitDerived;

  const enter = useCallback(
    (next: InteractionMode, refusal: string) => {
      if (replayActive) {
        toast.info(refusal);
        return;
      }
      exitDerivedRef.current();
      setOwned(next);
    },
    [replayActive]
  );

  const enterDispatch = useCallback(
    () => enter(DISPATCH, "Dispatch is unavailable during replay"),
    [enter]
  );

  const enterDrawGeofence = useCallback(
    () => enter(DRAW_GEOFENCE, "Zone drawing is unavailable during replay"),
    [enter]
  );

  const exitToBrowse = useCallback(() => {
    exitDerivedRef.current();
    setOwned(BROWSE);
  }, []);

  // A derived mode starting (from its own panel, the launcher or the palette)
  // outranks an owned one: its hook has already changed what a map click does,
  // so the owned mode has to let go rather than run underneath it.
  const derivedActive = derived !== null;
  useEffect(() => {
    if (derivedActive) setOwned(BROWSE);
  }, [derivedActive]);

  // A replay starting on the server force-exits any active mode.
  useEffect(() => {
    if (replayActive) {
      exitDerivedRef.current();
      setOwned(BROWSE);
    }
  }, [replayActive]);

  const mode = derived ?? owned;

  return useMemo(
    () => ({ mode, enterDispatch, enterDrawGeofence, exitToBrowse }),
    [mode, enterDispatch, enterDrawGeofence, exitToBrowse]
  );
}

// ─── Global keyboard dispatcher ─────────────────────────────────────

export type GlobalKeyAction =
  | "exit-mode"
  | "confirm-mode"
  | "clear-selection"
  | "close-panel"
  | "start-mode"
  | "none";

/** Single-letter shortcuts that start a map mode from browse. */
export const MODE_SHORTCUTS: Record<string, InteractionModeKind> = {
  d: "dispatch",
  j: "place-job",
  g: "draw-geofence",
  h: "draw-heatzone",
};

export interface GlobalKeyContext {
  modeKind: InteractionModeKind;
  /** The active mode's primary (Enter) action can run right now. */
  canConfirmMode: boolean;
  hasSelection: boolean;
  panelOpen: boolean;
  /**
   * An overlay that owns its own keyboard (the map context menu, the
   * CreateZoneDialog, the command palette) is open. The global dispatcher must
   * stand down so dismissing a menu doesn't also clear the selection or exit
   * the mode underneath it.
   */
  overlayOpen: boolean;
}

/**
 * Pure routing for the single window-level keyboard listener.
 *
 * Escape priority: exit the active map mode → clear the selection (closes the
 * inspector) → close the open dock panel. Enter runs the active mode's primary
 * action (close the polygon, submit the pending dispatch) when it is available.
 * A bare letter in `MODE_SHORTCUTS` starts that mode, but only from browse —
 * mid-mode, a stray keypress must never swap the tool under the operator.
 */
export function keyActionFor(key: string, ctx: GlobalKeyContext): GlobalKeyAction {
  // While an overlay (context menu / dialog) is open, it owns the keyboard —
  // the app-level actions stand down entirely.
  if (ctx.overlayOpen) return "none";
  const inMode = ctx.modeKind !== "browse";

  if (key === "Escape") {
    if (inMode) return "exit-mode";
    if (ctx.hasSelection) return "clear-selection";
    if (ctx.panelOpen) return "close-panel";
    return "none";
  }
  if (key === "Enter") {
    return inMode && ctx.canConfirmMode ? "confirm-mode" : "none";
  }
  if (!inMode && MODE_SHORTCUTS[key.toLowerCase()]) return "start-mode";
  return "none";
}

export interface GlobalKeyHandlers {
  onExitMode: () => void;
  onConfirmMode: () => void;
  onClearSelection: () => void;
  onClosePanel: () => void;
  onStartMode: (kind: InteractionModeKind) => void;
}

/**
 * The app's ONE window-level keydown listener. Replaces the competing listeners
 * that used to live in useDispatchShortcuts, GeofenceDrawTool, DockPanel,
 * Inspector and DeckGLMap — several of which fired on the same Escape press,
 * so one keystroke unwound two or three things at once. Context and handlers
 * are read through refs so the listener is subscribed exactly once.
 */
export function useInteractionKeyboard(ctx: GlobalKeyContext, handlers: GlobalKeyHandlers): void {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // An overlay (context menu / dialog / command palette) that already
      // consumed this key marks it handled — never double-fire an app action on
      // top of it. This backs up the `overlayOpen` context flag since
      // window-vs-document listener ordering isn't guaranteed.
      if (e.defaultPrevented) return;
      // Chorded keys belong to the browser and the palette (⌘K), not here.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
        case "exit-mode":
          h.onExitMode();
          break;
        case "confirm-mode":
          h.onConfirmMode();
          break;
        case "clear-selection":
          h.onClearSelection();
          break;
        case "close-panel":
          h.onClosePanel();
          break;
        case "start-mode":
          h.onStartMode(MODE_SHORTCUTS[e.key.toLowerCase()]);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

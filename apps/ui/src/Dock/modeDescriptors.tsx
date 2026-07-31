import type { ReactNode } from "react";
import { Directions, GeofenceIcon, JobIcon, DrawIcon, HeatZone } from "@/components/Icons";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionMode, InteractionModeKind } from "@/hooks/useInteractionMode";
import type { JobDraftStage } from "@/hooks/useJobDraft";
import { drawProgressHint, MIN_GEOFENCE_VERTICES } from "@/lib/geofenceHints";
import type { StatusTone } from "./DockPanelKit";

/** A mode's Enter action, rendered as the mode rail's primary button. */
export interface ModeAction {
  label: string;
  run: () => void;
  enabled: boolean;
}

/**
 * Everything the UI needs to know about the active map mode, in one shape.
 *
 * This is the single description of a mode: the dock's mode rail renders it,
 * the app's keyboard dispatcher runs its `exit`/`primary`, the mode guard reads
 * `dirty` to decide whether leaving needs a confirmation, and the command
 * palette reuses the same labels. Before this table, that copy and those
 * branches were duplicated across ModeBanner, keyActionFor and FleetPanel's
 * DispatchStatusBar — three surfaces that drifted into three different verbs
 * for the same act.
 */
export interface ModeDescriptor {
  kind: Exclude<InteractionModeKind, "browse">;
  label: string;
  icon: ReactNode;
  tone: StatusTone;
  /** Short live readout ("4 points", "2 vehicles · 3 stops"), rendered mono. */
  status: string | null;
  /** What to do next, in the imperative. */
  hint: string;
  /** Bound to Enter and to the rail's filled button. */
  primary?: ModeAction;
  /** Bound to Escape and to the rail's Exit button. */
  exit: () => void;
  exitLabel: string;
  /** A server round-trip is in flight; the rail shows a spinner. */
  busy: boolean;
  /**
   * In-flight work that switching modes would throw away, phrased as an object
   * ("4-point zone") so the guard can ask "Discard 4-point zone?". `null` when
   * there is nothing to lose.
   */
  dirty: string | null;
  /** The map can't be panned in this mode — worth saying out loud. */
  locksPan: boolean;
}

export interface ModeContext {
  dispatch: {
    state: DispatchState;
    selectedCount: number;
    stopCount: number;
    assignmentCount: number;
    successCount: number;
    failureCount: number;
    onExit: () => void;
    onDispatch: () => void;
    onRetryFailed: () => void;
  };
  geofence: {
    vertexCount: number;
    onCancel: () => void;
    onConfirm: () => void;
  };
  job: {
    stage: JobDraftStage;
    onCancel: () => void;
  };
  heatzone: {
    onStopDraw: () => void;
    onDeselect: () => void;
  };
}

function describeDispatch(ctx: ModeContext["dispatch"]): ModeDescriptor {
  const base = {
    kind: "dispatch",
    label: "Dispatch",
    icon: <Directions />,
    tone: "accent",
    exit: ctx.onExit,
    locksPan: false,
  } as const;

  switch (ctx.state) {
    case DispatchState.ROUTE: {
      // Before the first stop lands there are no assignments yet — reporting
      // "0 vehicles" while the operator has some selected reads as a bug.
      const routed = ctx.assignmentCount > 0;
      return {
        ...base,
        status: routed
          ? `${ctx.assignmentCount} vehicle${ctx.assignmentCount === 1 ? "" : "s"} · ${
              ctx.stopCount
            } stop${ctx.stopCount === 1 ? "" : "s"}`
          : `${ctx.selectedCount} selected`,
        hint: routed ? "Click to add a stop · drag to move" : "Click the map to place a stop",
        primary: {
          label: "Dispatch",
          run: ctx.onDispatch,
          enabled: routed,
        },
        exitLabel: "Clear",
        busy: false,
        dirty: routed
          ? `${ctx.assignmentCount} pending assignment${ctx.assignmentCount === 1 ? "" : "s"}`
          : `${ctx.selectedCount} selected vehicle${ctx.selectedCount === 1 ? "" : "s"}`,
      };
    }

    case DispatchState.DISPATCH:
      return {
        ...base,
        status: null,
        hint: "Dispatching…",
        exitLabel: "Clear",
        busy: true,
        dirty: "dispatch in flight",
      };

    case DispatchState.RESULTS:
      return {
        ...base,
        status: `${ctx.successCount} sent${
          ctx.failureCount > 0 ? ` · ${ctx.failureCount} failed` : ""
        }`,
        hint:
          ctx.failureCount > 0 ? "Some vehicles did not accept the route" : "All routes accepted",
        tone: ctx.failureCount > 0 ? "warn" : "ok",
        primary:
          ctx.failureCount > 0
            ? { label: "Retry failed", run: ctx.onRetryFailed, enabled: true }
            : { label: "Done", run: ctx.onExit, enabled: true },
        exitLabel: "Done",
        busy: false,
        dirty: null,
      };

    default:
      // SELECT (and BROWSE, transiently, before the sub-state catches up)
      return {
        ...base,
        status: ctx.selectedCount > 0 ? `${ctx.selectedCount} selected` : null,
        hint:
          ctx.selectedCount > 0
            ? "Click the map to place a stop"
            : "Click vehicles on the map or in Fleet",
        exitLabel: "Exit",
        busy: false,
        dirty:
          ctx.selectedCount > 0
            ? `${ctx.selectedCount} selected vehicle${ctx.selectedCount === 1 ? "" : "s"}`
            : null,
      };
  }
}

function describeGeofence(ctx: ModeContext["geofence"]): ModeDescriptor {
  const canConfirm = ctx.vertexCount >= MIN_GEOFENCE_VERTICES;
  return {
    kind: "draw-geofence",
    label: "Draw zone",
    icon: <GeofenceIcon />,
    tone: "accent",
    status: `${ctx.vertexCount} point${ctx.vertexCount === 1 ? "" : "s"}`,
    hint: drawProgressHint(ctx.vertexCount) ?? "Click the first point to close · drag to move",
    primary: { label: "Finish zone", run: ctx.onConfirm, enabled: canConfirm },
    exit: ctx.onCancel,
    exitLabel: "Cancel",
    busy: false,
    dirty: ctx.vertexCount > 0 ? `${ctx.vertexCount}-point zone` : null,
    locksPan: false,
  };
}

function describeJob(ctx: ModeContext["job"]): ModeDescriptor {
  const atDropoff = ctx.stage === "dropoff";
  return {
    kind: "place-job",
    label: "New job",
    icon: <JobIcon />,
    tone: "accent",
    status: atDropoff ? "Dropoff" : "Pickup",
    hint: atDropoff
      ? "Click the map to set the dropoff — this creates the job"
      : "Click the map to set the pickup",
    exit: ctx.onCancel,
    exitLabel: "Cancel",
    busy: false,
    dirty: atDropoff ? "half-placed job" : null,
    locksPan: false,
  };
}

function describeHeatzoneDraw(ctx: ModeContext["heatzone"]): ModeDescriptor {
  return {
    kind: "draw-heatzone",
    label: "Heat zone",
    icon: <DrawIcon />,
    tone: "warn",
    status: null,
    hint: "Drag on the map to lasso a zone · panning is locked",
    primary: { label: "Done", run: ctx.onStopDraw, enabled: true },
    exit: ctx.onStopDraw,
    exitLabel: "Done",
    busy: false,
    dirty: null,
    locksPan: true,
  };
}

function describeHeatzoneEdit(ctx: ModeContext["heatzone"]): ModeDescriptor {
  return {
    kind: "edit-heatzone",
    label: "Edit zone",
    icon: <HeatZone />,
    tone: "warn",
    status: null,
    hint: "Drag the handles to reshape · panning is locked",
    primary: { label: "Done", run: ctx.onDeselect, enabled: true },
    exit: ctx.onDeselect,
    exitLabel: "Done",
    busy: false,
    dirty: null,
    locksPan: true,
  };
}

/** The one place a mode turns into words, tone and actions. */
export function describeMode(mode: InteractionMode, ctx: ModeContext): ModeDescriptor | null {
  switch (mode.kind) {
    case "browse":
      return null;
    case "dispatch":
      return describeDispatch(ctx.dispatch);
    case "draw-geofence":
      return describeGeofence(ctx.geofence);
    case "place-job":
      return describeJob(ctx.job);
    case "draw-heatzone":
      return describeHeatzoneDraw(ctx.heatzone);
    case "edit-heatzone":
      return describeHeatzoneEdit(ctx.heatzone);
  }
}

// ─── Launcher ───────────────────────────────────────────────────────

export interface ModeLaunchItem {
  kind: Exclude<InteractionModeKind, "browse" | "edit-heatzone">;
  label: string;
  description: string;
  icon: ReactNode;
  /** Bare-key shortcut, mirroring MODE_SHORTCUTS. */
  shortcut: string;
}

/**
 * Every way to put the map into a mode, in one menu. These four used to live
 * one-per-panel (dispatch under Fleet, jobs under Fleet › Jobs, geofences and
 * heat zones under two different Monitor tabs), so finding a drawing tool meant
 * remembering which panel owned it. The panels keep their own buttons; this is
 * the one place that lists them together.
 */
export const MODE_LAUNCH_ITEMS: ModeLaunchItem[] = [
  {
    kind: "dispatch",
    label: "Dispatch vehicles",
    description: "Pick vehicles, then place their stops",
    icon: <Directions />,
    shortcut: "D",
  },
  {
    kind: "place-job",
    label: "New job",
    description: "Place a pickup and a dropoff",
    icon: <JobIcon />,
    shortcut: "J",
  },
  {
    kind: "draw-geofence",
    label: "Draw geofence",
    description: "Outline an area that raises enter/exit alerts",
    icon: <GeofenceIcon />,
    shortcut: "G",
  },
  {
    kind: "draw-heatzone",
    label: "Draw heat zone",
    description: "Lasso an area of higher demand",
    icon: <DrawIcon />,
    shortcut: "H",
  },
];

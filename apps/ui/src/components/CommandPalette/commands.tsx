import client from "@/utils/client";
import { toast, toErrorMessage } from "@/lib/toast";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";
import { DispatchState } from "@/hooks/useDispatchState";
import { SPEED_PRESETS, speedDescription } from "@/Dock/tempoScale";
import type { Modifiers, ReplayStatus, StartOptions } from "@/types";
import {
  CarIcon,
  ChartIcon,
  ClockIcon,
  CloseIcon,
  Directions,
  DrawIcon,
  EyeIcon,
  FastForward,
  GaugeIcon,
  Gear,
  GeofenceIcon,
  HeatZone,
  JobIcon,
  Pause,
  Play,
  Record,
  Reset,
  SeedIcon,
  Stop,
  TrashIcon,
  WarningTriangle,
} from "@/components/Icons";
import { closeDockPanel, openDockPanel } from "./dockControls";
import type { PaletteAction } from "./types";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast — the same contract `Dock/PlaybackCluster.tsx` uses for its transport
 * buttons (its helper is module-private, so the palette keeps its own copy
 * rather than reaching into the dock).
 */
async function runWithToast(
  action: () => Promise<{ error?: string } | unknown>,
  { success, failure }: { success?: string; failure: string }
): Promise<void> {
  try {
    const res = (await action()) as { error?: string } | undefined;
    if (res && typeof res === "object" && "error" in res && res.error) {
      toast.error(`${failure}: ${res.error}`);
      return;
    }
    if (success) toast.success(success);
  } catch (err) {
    toast.error(toErrorMessage(err, failure));
  }
}

/** Layer-visibility toggles, mirroring `Controls/TogglesPanel.tsx`'s list. */
const VISIBILITY_TOGGLES: { key: keyof Modifiers; label: string }[] = [
  { key: "showDirections", label: "Network" },
  { key: "showTrafficOverlay", label: "Traffic Colours" },
  { key: "showVehicles", label: "Vehicles" },
  { key: "showHeatmap", label: "Heatmap" },
  { key: "showHeatzones", label: "Zones" },
  { key: "showPOIs", label: "POIs" },
  { key: "showSpeedLimits", label: "Speed Limits" },
  { key: "showBreadcrumbs", label: "Trails" },
];

/** Replay speeds offered by `Dock/ReplayDock.tsx`. */
const REPLAY_SPEEDS = [1, 2, 4] as const;

export interface CommandDeps {
  /** Simulation transport (dock Playback cluster). */
  running: boolean;
  options: StartOptions;

  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /** Replay transport (dock swaps to `ReplayDock` while replaying). */
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  /**
   * Fleet & Dispatch panel. Spread into primitives + handlers rather than
   * taking the whole `DispatchFlow` (a fresh object literal every render) so
   * callers can usefully memoize the built action list.
   */
  dispatchMode: boolean;
  dispatchState: DispatchState;
  assignmentCount: number;
  hasFailedDispatches: boolean;
  onToggleDispatchMode: () => void;
  onExitDispatchMode: () => void;
  onDispatch: () => Promise<void>;
  onRetryFailedDispatches: () => void;

  /**
   * Job board. `jobPlacementActive` flips the entry between starting and
   * abandoning a placement, so the palette never offers a second "New job"
   * while one is half-placed.
   */
  jobPlacementActive: boolean;
  onStartJob: () => void;
  onCancelJobPlacement: () => void;

  /**
   * Device fault injection. `faultsArmed` flips the entry between arming and
   * disarming; `onClearFaultState` is always offered so a run can be restarted
   * from a known device state without opening the panel.
   */
  faultsArmed: boolean;
  onToggleFaults: () => void;
  onClearFaultState: () => void;

  /** Monitor panel. */
  onCreateRandomIncident: () => Promise<void>;
  onStartGeofenceDrawing: () => void;
  heatzones: Pick<HeatzoneEditor, "isDrawing" | "toggleDraw" | "seed" | "clearAll">;

  /** Settings panel → Visibility. */
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;

  /** Clears the current vehicle/POI/road selection (map Escape equivalent). */
  onClearSelection: () => void;
}

/**
 * Every action the dock exposes, as palette entries. Built from the handlers
 * `App.tsx` already owns; where the dock keeps state to itself (which panel is
 * open) we drive its own buttons — see `dockControls.ts`.
 *
 * Entries are state-aware: the transport reads "Pause simulation" while
 * running, replay controls only appear during a replay, and dispatch actions
 * only appear once they would do something.
 */
export function buildCommands(deps: CommandDeps): PaletteAction[] {
  const {
    running,
    options,
    isRecording,
    onStartRecording,
    onStopRecording,
    replayStatus,
    onPauseReplay,
    onResumeReplay,
    onStopReplay,
    onSetReplaySpeed,
    dispatchMode,
    dispatchState,
    assignmentCount,
    hasFailedDispatches,
    onToggleDispatchMode,
    onExitDispatchMode,
    onDispatch,
    onRetryFailedDispatches,
    jobPlacementActive,
    onStartJob,
    onCancelJobPlacement,
    faultsArmed,
    onToggleFaults,
    onClearFaultState,
    onCreateRandomIncident,
    onStartGeofenceDrawing,
    heatzones,
    modifiers,
    onChangeModifiers,
    onClearSelection,
  } = deps;

  const replaying = replayStatus.mode === "replay";
  const actions: PaletteAction[] = [];

  // ── Simulation transport ───────────────────────────────────────────
  actions.push(
    running
      ? {
          id: "sim-pause",
          label: "Pause simulation",
          keywords: "stop halt playback transport",
          hint: "Simulation",
          icon: <Pause />,
          run: () =>
            void runWithToast(() => client.stop(), {
              success: "Simulation paused",
              failure: "Failed to pause simulation",
            }),
        }
      : {
          id: "sim-start",
          label: "Start simulation",
          keywords: "play run resume playback transport",
          hint: "Simulation",
          icon: <Play />,
          run: () =>
            void runWithToast(() => client.start(options), {
              success: "Simulation started",
              failure: "Failed to start simulation",
            }),
        },
    {
      id: "sim-reset",
      label: "Reset simulation",
      keywords: "restart clear",
      hint: "Simulation",
      icon: <Reset />,
      run: () =>
        void runWithToast(() => client.reset(), {
          success: "Simulation reset",
          failure: "Failed to reset simulation",
        }),
    },
    isRecording
      ? {
          id: "recording-stop",
          label: "Stop recording",
          keywords: "capture save session",
          hint: "Recording",
          icon: <Stop />,
          run: () => void onStopRecording(),
        }
      : {
          id: "recording-start",
          label: "Start recording",
          keywords: "capture session",
          hint: "Recording",
          icon: <Record />,
          run: () => void onStartRecording(),
        }
  );

  // ── Tempo (dock Tempo cluster) ─────────────────────────────────────
  for (const preset of SPEED_PRESETS) {
    actions.push({
      id: `tempo-${preset}`,
      label: `Set tempo to ${preset}×`,
      keywords: `speed multiplier clock ${speedDescription(preset)}`,
      hint: "Tempo",
      icon: <FastForward />,
      run: () =>
        void runWithToast(() => client.setClock({ speedMultiplier: preset }), {
          success: `Tempo set to ${preset}×`,
          failure: "Failed to set tempo",
        }),
    });
  }

  // ── Dock panels ────────────────────────────────────────────────────
  actions.push(
    {
      id: "panel-tempo",
      label: "Open Tempo panel",
      keywords: "clock speed time of day",
      hint: "Panel",
      icon: <ClockIcon />,
      run: () => openDockPanel("Tempo details"),
    },
    {
      id: "panel-fleet",
      label: "Open Fleet & Dispatch panel",
      keywords: "vehicles fleets dispatch list",
      hint: "Panel",
      icon: <CarIcon />,
      run: () => openDockPanel("Fleet & Dispatch"),
    },
    {
      id: "panel-sinks",
      label: "Open Sinks & Source panel",
      keywords: "adapter kafka graphql config health",
      hint: "Panel",
      icon: <Gear />,
      run: () => openDockPanel("Sinks & Source"),
    },
    {
      id: "panel-monitor",
      label: "Open Monitor panel",
      keywords: "incidents analytics geofences heat zones",
      hint: "Panel",
      icon: <ChartIcon />,
      run: () => openDockPanel("Monitor"),
    },
    {
      id: "panel-settings",
      label: "Open Settings panel",
      keywords: "visibility scenarios recordings advanced tuning",
      hint: "Panel",
      icon: <GaugeIcon />,
      run: () => openDockPanel("Settings"),
    },
    {
      id: "panel-close",
      label: "Close dock panel",
      keywords: "dismiss hide",
      hint: "Panel",
      icon: <CloseIcon />,
      run: () => closeDockPanel(),
    }
  );

  // ── Dispatch (Fleet & Dispatch panel) ──────────────────────────────
  actions.push(
    dispatchMode
      ? {
          id: "dispatch-exit",
          label: "Exit dispatch mode",
          keywords: "cancel done browse",
          hint: "Dispatch",
          icon: <Directions />,
          run: onExitDispatchMode,
        }
      : {
          id: "dispatch-enter",
          label: "Enter dispatch mode",
          keywords: "route send waypoints assign",
          hint: "Dispatch",
          icon: <Directions />,
          run: onToggleDispatchMode,
        }
  );
  if (dispatchState === DispatchState.ROUTE && assignmentCount > 0) {
    actions.push({
      id: "dispatch-run",
      label: `Dispatch ${assignmentCount} selected ${
        assignmentCount === 1 ? "vehicle" : "vehicles"
      }`,
      keywords: "send route go confirm",
      hint: "Dispatch",
      icon: <Directions />,
      run: () => void onDispatch(),
    });
  }
  if (hasFailedDispatches) {
    actions.push({
      id: "dispatch-retry",
      label: "Retry failed dispatches",
      keywords: "again errors",
      hint: "Dispatch",
      icon: <Reset />,
      run: onRetryFailedDispatches,
    });
  }

  // ── Job board ──────────────────────────────────────────────────────
  actions.push(
    jobPlacementActive
      ? {
          id: "job-cancel-placement",
          label: "Cancel job placement",
          keywords: "abort stop pickup dropoff",
          hint: "Jobs",
          icon: <JobIcon />,
          run: onCancelJobPlacement,
        }
      : {
          id: "job-new",
          label: "New job",
          keywords: "trip order pickup dropoff dispatch delivery",
          hint: "Jobs",
          icon: <JobIcon />,
          run: onStartJob,
        }
  );

  // ── Device faults ──────────────────────────────────────────────────
  actions.push(
    {
      id: "faults-toggle",
      label: faultsArmed ? "Disarm device faults" : "Arm device faults",
      keywords: "fault injection gps clock battery spoof device broken",
      hint: "Faults",
      icon: <WarningTriangle />,
      run: onToggleFaults,
    },
    {
      id: "faults-clear-state",
      label: "Clear device fault state",
      keywords: "reset battery frozen queue faults device",
      hint: "Faults",
      icon: <Reset />,
      run: onClearFaultState,
    }
  );

  // ── Monitor panel actions ──────────────────────────────────────────
  actions.push(
    {
      id: "incident-random",
      label: "Create random incident",
      keywords: "accident breakdown hazard monitor",
      hint: "Monitor",
      icon: <WarningTriangle />,
      run: () => void onCreateRandomIncident(),
    },
    {
      id: "geofence-draw",
      label: "Draw geofence zone",
      keywords: "fence polygon boundary area",
      hint: "Monitor",
      icon: <GeofenceIcon />,
      run: onStartGeofenceDrawing,
    },
    {
      id: "heatzone-draw",
      label: heatzones.isDrawing ? "Stop drawing heat zone" : "Draw heat zone",
      keywords: "lasso demand hotspot",
      hint: "Heat zones",
      icon: <DrawIcon />,
      run: heatzones.toggleDraw,
    },
    {
      id: "heatzone-seed",
      label: "Seed random heat zones",
      keywords: "generate demand hotspot",
      hint: "Heat zones",
      icon: <SeedIcon />,
      run: () => void heatzones.seed(),
    },
    {
      id: "heatzone-clear",
      label: "Clear all heat zones",
      keywords: "delete remove hotspot",
      hint: "Heat zones",
      icon: <TrashIcon />,
      run: () => void heatzones.clearAll(),
    }
  );

  // ── Settings panel → Visibility toggles ────────────────────────────
  for (const { key, label } of VISIBILITY_TOGGLES) {
    const on = modifiers[key];
    actions.push({
      id: `toggle-${key}`,
      label: `${on ? "Hide" : "Show"} ${label}`,
      keywords: `toggle layer visibility ${label}`,
      hint: "Visibility",
      icon: on ? <EyeIcon /> : <HeatZone />,
      run: () => onChangeModifiers(key)(!on),
    });
  }

  // ── Replay transport (only while a recording is playing back) ──────
  if (replaying) {
    actions.push(
      replayStatus.paused
        ? {
            id: "replay-resume",
            label: "Resume replay",
            keywords: "play playback recording",
            hint: "Replay",
            icon: <Play />,
            run: () => void onResumeReplay(),
          }
        : {
            id: "replay-pause",
            label: "Pause replay",
            keywords: "playback recording",
            hint: "Replay",
            icon: <Pause />,
            run: () => void onPauseReplay(),
          },
      {
        id: "replay-stop",
        label: "Stop replay",
        keywords: "exit playback live",
        hint: "Replay",
        icon: <Stop />,
        run: () => void onStopReplay(),
      }
    );
    for (const speed of REPLAY_SPEEDS) {
      actions.push({
        id: `replay-speed-${speed}`,
        label: `Set replay speed to ${speed}×`,
        keywords: "playback rate faster slower",
        hint: "Replay",
        icon: <FastForward />,
        run: () => void onSetReplaySpeed(speed),
      });
    }
  }

  // ── Selection ──────────────────────────────────────────────────────
  actions.push({
    id: "selection-clear",
    label: "Clear selection",
    keywords: "deselect unselect vehicle poi road",
    hint: "Selection",
    icon: <CloseIcon />,
    run: onClearSelection,
  });

  return actions;
}

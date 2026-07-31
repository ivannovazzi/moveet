import client from "@/utils/client";
import { toast, toErrorMessage } from "@/lib/toast";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import { MODE_LAUNCH_ITEMS, type ModeDescriptor } from "@/Dock/modeDescriptors";
import { DOCK_SECTIONS } from "@/Dock/dockSections";
import { SPEED_PRESETS, speedDescription } from "@/Dock/tempoScale";
import type { Modifiers, ReplayStatus, StartOptions } from "@/types";
import {
  ClockIcon,
  CloseIcon,
  Directions,
  EyeIcon,
  FastForward,
  HeatZone,
  Pause,
  Play,
  Record,
  Reset,
  SeedIcon,
  Stop,
  TrashIcon,
  WarningTriangle,
} from "@/components/Icons";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import type { PaletteAction } from "./types";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast — the same contract `Dock/TransportCluster.tsx` uses for its transport
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

/** Replay speeds offered by the dock's replay rail. */
const REPLAY_SPEEDS = [1, 2, 4] as const;

export interface CommandDeps {
  /**
   * The dock's panel navigation, lifted to `App.tsx` and shared with `Dock`.
   * Opening a panel from here and clicking the dock's own cluster button are
   * the same state transition, so the two can never disagree.
   */
  dock: DockNavigation;

  /** Simulation transport (dock Playback cluster). */
  running: boolean;
  options: StartOptions;

  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /** Replay transport (the dock's centre slot while replaying). */
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  /**
   * The active map mode as the dock describes it (null while browsing), and the
   * guarded way into one. The palette lists the same four tools the dock's
   * launcher does, with the same labels, and offers the active mode's own exit
   * and primary action rather than re-deriving either.
   */
  modeDescriptor: ModeDescriptor | null;
  onStartMode: (kind: InteractionModeKind) => void;

  /**
   * Dispatch specifics the mode rail doesn't carry. Spread into primitives
   * rather than taking the whole `DispatchFlow` (a fresh object literal every
   * render) so callers can usefully memoize the built action list.
   */
  dispatchState: DispatchState;
  assignmentCount: number;
  hasFailedDispatches: boolean;
  onDispatch: () => Promise<void>;
  onRetryFailedDispatches: () => void;

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
  heatzones: Pick<HeatzoneEditor, "seed" | "clearAll">;

  /** Settings panel → Visibility. */
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;

  /** Clears the current vehicle/POI/road selection (map Escape equivalent). */
  onClearSelection: () => void;
}

/**
 * Every action the dock exposes, as palette entries. Built entirely from
 * handlers `App.tsx` owns — including `dock`, the dock's own panel navigation
 * — so the palette never reaches into rendered markup to drive the UI.
 *
 * Entries are state-aware: the transport reads "Pause simulation" while
 * running, replay controls only appear during a replay, and dispatch actions
 * only appear once they would do something.
 */
export function buildCommands(deps: CommandDeps): PaletteAction[] {
  const {
    dock,
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
    modeDescriptor,
    onStartMode,
    dispatchState,
    assignmentCount,
    hasFailedDispatches,
    onDispatch,
    onRetryFailedDispatches,
    faultsArmed,
    onToggleFaults,
    onClearFaultState,
    onCreateRandomIncident,
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

  // ── Dock sections ──────────────────────────────────────────────────
  // One entry per section *button*, straight off the same registry the dock
  // row is built from — so every view the dock can show is reachable by name,
  // and a new tab needs no palette work.
  actions.push({
    id: "panel-tempo",
    label: "Open Tempo panel",
    keywords: "clock speed time of day",
    hint: "Panel",
    icon: <ClockIcon />,
    run: dock.toggleTempo,
  });
  for (const section of DOCK_SECTIONS) {
    for (const tab of section.tabs) {
      actions.push({
        id: `panel-${section.id}-${tab.id}`,
        label: `Open ${section.label} › ${tab.label}`,
        keywords: `${section.label} ${tab.label} panel dock section`,
        hint: section.label,
        icon: section.icon,
        run: () => dock.open(section.id, tab.id),
      });
    }
  }
  actions.push({
    id: "panel-close",
    label: "Collapse dock section",
    keywords: "dismiss hide close panel",
    hint: "Panel",
    icon: <CloseIcon />,
    run: dock.close,
  });

  // ── Map modes ──────────────────────────────────────────────────────
  // The same four the dock's launcher offers, with the same labels — plus the
  // active mode's own exit, so a mode is never left running with no way out
  // that the operator can find from the keyboard.
  if (modeDescriptor) {
    actions.push({
      id: "mode-exit",
      label: `${modeDescriptor.exitLabel} — ${modeDescriptor.label.toLowerCase()}`,
      keywords: "exit cancel done leave mode browse",
      hint: "Mode",
      icon: modeDescriptor.icon,
      run: modeDescriptor.exit,
    });
  } else {
    for (const item of MODE_LAUNCH_ITEMS) {
      actions.push({
        id: `mode-${item.kind}`,
        label: item.label,
        keywords: `${item.description} start mode map`,
        hint: "Mode",
        icon: item.icon,
        run: () => onStartMode(item.kind),
      });
    }
  }

  // ── Dispatch specifics ─────────────────────────────────────────────
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

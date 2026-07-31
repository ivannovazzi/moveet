import { cn } from "@/lib/utils";
import type { ClockState, ReplayStatus, StartOptions } from "@/types";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import type { ModeGuard } from "@/hooks/useModeGuard";
import DockStateRail from "./DockStateRail";
import GuardPrompt from "./GuardPrompt";
import ModeLauncher from "./ModeLauncher";
import ModeRail from "./ModeRail";
import ReplayRail from "./ReplayRail";
import TempoInline from "./TempoInline";
import TransportCluster from "./TransportCluster";
import { TONE_TINT } from "./DockBarKit";
import type { ModeDescriptor } from "./modeDescriptors";

/**
 * What the operator is doing. One at a time, in precedence order: a pending
 * discard beats the mode it would discard, a replay beats a mode (modes are
 * refused during a replay anyway), a mode beats the live run.
 */
export type DockActivity = "guard" | "replay" | "mode" | "live";

export function dockActivity({
  pendingDiscard,
  replaying,
  inMode,
}: {
  pendingDiscard: boolean;
  replaying: boolean;
  inMode: boolean;
}): DockActivity {
  if (pendingDiscard) return "guard";
  if (replaying) return "replay";
  if (inMode) return "mode";
  return "live";
}

/**
 * Which of the dock's clusters an activity keeps.
 *
 * This table is the whole idea: the dock is not a fixed bar with a context slot
 * bolted on, it is the set of controls that the current work needs and nothing
 * else. Reading it top to bottom is the interaction model.
 *
 *   launcher  — starting new work. Only when no work is running.
 *   transport — play/pause and reset of the *live* run. Kept while dispatching
 *               (traffic keeps moving and pausing it is a legitimate move) and
 *               dropped while drawing, where it steers nothing the operator is
 *               looking at. During a replay the playback owns the transport, so
 *               the live one would be two play buttons for two timelines.
 *   record    — capturing the live run. Live only: arming a recording in the
 *               middle of placing a job is not a thing anyone does, and the key
 *               was pure noise there.
 *   tempo     — the live clock's multiplier. Same reasoning as transport, plus
 *               it genuinely does nothing during a replay (it used to sit there
 *               disabled, which is a control saying "not now" instead of the bar
 *               simply not offering it).
 */
const CLUSTERS: Record<
  DockActivity,
  { launcher: boolean; transport: boolean; record: boolean; tempo: boolean }
> = {
  live: { launcher: true, transport: true, record: true, tempo: true },
  mode: { launcher: false, transport: false, record: false, tempo: false },
  guard: { launcher: false, transport: false, record: false, tempo: false },
  replay: { launcher: false, transport: false, record: false, tempo: false },
};

/** Dispatch is long-running and rides the live sim, so it keeps time control. */
const MODES_KEEPING_TIME: ReadonlySet<string> = new Set(["dispatch"]);

export interface DockDeckProps {
  connected: boolean;
  running: boolean;
  options: StartOptions;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  clock: ClockState;
  tempoOpen: boolean;
  onToggleTempo: () => void;
  tempoButtonRef: React.RefObject<HTMLButtonElement | null>;

  modeDescriptor: ModeDescriptor | null;
  guard: ModeGuard;
  onStartMode: (kind: InteractionModeKind) => void;

  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
}

const Divider = () => <div className="mx-0.5 my-2 w-px shrink-0 self-stretch bg-border-soft" />;

/**
 * The dock's contents: the keys the current activity needs, in a frame that
 * doesn't move.
 *
 * Every state is one row of keys — no prose, no parked controls, no control that
 * is present but disabled to mean "not now". The frame has a floor width so the
 * sets land in roughly the same place, and the whole thing is centred on the
 * viewport, so the play key is always within a few pixels of where the hand left
 * it even as the set around it changes.
 *
 * The tint and the hairline carry the state that words used to: the mode's tone
 * washes the surface, the hairline is a playhead under a replay and a red pulse
 * under a capture.
 */
export default function DockDeck({
  connected,
  running,
  options,
  isRecording,
  onStartRecording,
  onStopRecording,
  clock,
  tempoOpen,
  onToggleTempo,
  tempoButtonRef,
  modeDescriptor,
  guard,
  onStartMode,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
}: DockDeckProps) {
  const replaying = replayStatus.mode === "replay";
  const activity = dockActivity({
    pendingDiscard: guard.pending !== null,
    replaying,
    inMode: modeDescriptor !== null,
  });

  const clusters = CLUSTERS[activity];
  // A mode that rides the live run keeps the run's controls; one that draws does
  // not. The exception is spelled out rather than folded into the table so it is
  // obvious there is exactly one.
  const keepsTime =
    activity === "mode" && modeDescriptor !== null && MODES_KEEPING_TIME.has(modeDescriptor.kind);
  const showRun = clusters.transport || keepsTime;
  // A capture in progress keeps its key in every activity except a replay (where
  // the live run isn't recording anything anyway): a recording the dock can't
  // stop is worse than one key more than the activity asked for.
  const showRecord = clusters.record || (isRecording && activity !== "replay");
  const showTransport = showRun || showRecord;
  const showTempo = clusters.tempo || keepsTime;

  const tint =
    activity === "guard"
      ? TONE_TINT.warn
      : activity === "mode" && modeDescriptor
        ? TONE_TINT[modeDescriptor.tone]
        : null;

  return (
    <>
      {tint && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 transition-colors duration-normal ease-standard",
            tint
          )}
        />
      )}

      {/* Keyed on the activity so a change crossfades the key set rather than
          snapping one row of buttons into another. */}
      <div
        key={activity}
        className="relative flex min-w-0 items-center gap-0.5 motion-safe:animate-fade-in-fast"
      >
        {activity === "guard" && guard.pending && (
          <GuardPrompt
            pending={guard.pending}
            onConfirm={guard.confirm}
            onDismiss={guard.dismiss}
          />
        )}

        {activity === "replay" && (
          <ReplayRail
            replayStatus={replayStatus}
            onPauseReplay={onPauseReplay}
            onResumeReplay={onResumeReplay}
            onStopReplay={onStopReplay}
            onSeekReplay={onSeekReplay}
            onSetReplaySpeed={onSetReplaySpeed}
          />
        )}

        {activity === "mode" && modeDescriptor && <ModeRail descriptor={modeDescriptor} />}

        {clusters.launcher && <ModeLauncher onStart={onStartMode} disabled={!connected} />}

        {showTransport && (
          <>
            {activity !== "live" && <Divider />}
            <TransportCluster
              running={running}
              options={options}
              isRecording={isRecording}
              onStartRecording={onStartRecording}
              onStopRecording={onStopRecording}
              guardRequest={guard.request}
              disabled={!connected}
              showRun={showRun}
              showRecord={showRecord}
            />
          </>
        )}

        {showTempo && (
          <>
            <Divider />
            <TempoInline
              clock={clock}
              detailsOpen={tempoOpen}
              onToggleDetails={onToggleTempo}
              buttonRef={tempoButtonRef}
            />
          </>
        )}
      </div>

      {/* The dock's hairline reports the timeline it is driving: a playhead under
          a replay, a red pulse under a capture, the mode's tone under a mode. */}
      <DockStateRail
        tone={activity === "mode" ? (modeDescriptor?.tone ?? null) : null}
        recording={isRecording && activity !== "replay"}
        replayProgress={
          replaying && replayStatus.duration
            ? (replayStatus.currentTime ?? 0) / replayStatus.duration
            : null
        }
      />
    </>
  );
}

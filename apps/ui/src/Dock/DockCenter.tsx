import { cn } from "@/lib/utils";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import type { ModeGuard } from "@/hooks/useModeGuard";
import type { ReplayStatus } from "@/types";
import type { ModeDescriptor } from "./modeDescriptors";
import { TONE_WASH } from "./DockBarKit";
import ModeLauncher from "./ModeLauncher";
import ModeRail from "./ModeRail";
import ReplayRail from "./ReplayRail";
import GuardPrompt from "./GuardPrompt";

export interface DockCenterProps {
  /** The active map mode, or null while browsing. */
  descriptor: ModeDescriptor | null;
  guard: ModeGuard;
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
  /** Starts a map mode (already guarded by the caller). */
  onStartMode: (kind: InteractionModeKind) => void;
  /** The simulator is unreachable: nothing new can be started. */
  offline: boolean;
}

/** Which of the four things the centre slot is currently saying. */
type CenterKind = "guard" | "replay" | "mode" | "browse";

/**
 * The one part of the dock that changes with what is going on. Everything
 * around it — transport and tempo on the left, panel clusters and status chips
 * on the right — stays put in every state, so the bar never rearranges itself
 * under the operator and no capability disappears (the old dock swapped its
 * entire self away for the duration of a replay).
 *
 * Precedence: a pending discard beats the mode it would discard; a replay beats
 * a mode (modes are refused during replay anyway); otherwise the active mode,
 * otherwise the launcher.
 */
export default function DockCenter({
  descriptor,
  guard,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
  onStartMode,
  offline,
}: DockCenterProps) {
  const replaying = replayStatus.mode === "replay";
  const kind: CenterKind = guard.pending
    ? "guard"
    : replaying
      ? "replay"
      : descriptor
        ? "mode"
        : "browse";

  // Each state gets the width its content needs; the bar animates between them
  // rather than reflowing instantly around a stretched flex child.
  const width =
    kind === "mode" || kind === "guard"
      ? "w-[520px]"
      : kind === "replay"
        ? "w-[470px]"
        : "w-[290px]";
  const wash = kind === "guard" ? TONE_WASH.warn : descriptor ? TONE_WASH[descriptor.tone] : null;

  return (
    <div
      className={cn(
        "mx-1 flex h-[42px] max-w-[calc(100vw-6rem)] items-center self-center overflow-hidden rounded-lg",
        "transition-[width,background-color,box-shadow] duration-normal ease-emphasized",
        width,
        replaying && !wash ? TONE_WASH.idle : wash
      )}
    >
      {/* keyed so switching states crossfades the content, not the slot */}
      <div key={kind} className="flex w-full animate-fade-in-fast items-center">
        {kind === "guard" && guard.pending && (
          <GuardPrompt
            pending={guard.pending}
            onConfirm={guard.confirm}
            onDismiss={guard.dismiss}
          />
        )}
        {kind === "replay" && (
          <ReplayRail
            replayStatus={replayStatus}
            onPauseReplay={onPauseReplay}
            onResumeReplay={onResumeReplay}
            onStopReplay={onStopReplay}
            onSeekReplay={onSeekReplay}
            onSetReplaySpeed={onSetReplaySpeed}
          />
        )}
        {kind === "mode" && descriptor && <ModeRail descriptor={descriptor} />}
        {kind === "browse" && <ModeLauncher onStart={onStartMode} disabled={offline} />}
      </div>
    </div>
  );
}

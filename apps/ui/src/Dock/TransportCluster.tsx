import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import type { StartOptions } from "@/types";
import { Pause, Play, Record, Reset } from "@/components/Icons";
import { toast, toErrorMessage } from "@/lib/toast";
import { IconButton } from "./DockBarKit";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast.
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface TransportClusterProps {
  /**
   * The simulation's run flag and start options, both from `App.tsx`. This used
   * to keep its own `client.onStatus` subscription and its own `useOptions`
   * poll alongside App's — two readings of one truth that could disagree.
   */
  running: boolean;
  options: StartOptions;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;
  /**
   * Runs an action, asking first if the active map mode is holding work that
   * would be lost (see `useModeGuard`). Reset goes through this; play/pause
   * doesn't, since it destroys nothing.
   */
  guardRequest: (action: () => void) => void;
  /** The simulator is unreachable — transport would fail. */
  disabled?: boolean;
  /**
   * Whether to offer the record key. False while the operator is in the middle
   * of a mode: arming a capture is not part of placing a job, and the key was
   * one more target to skip over on the way to the ones that are.
   */
  showRecord?: boolean;
  /**
   * Whether to offer play/pause and reset. False while a mode is drawing, where
   * the cluster is only here so a running capture stays stoppable.
   */
  showRun?: boolean;
}

/**
 * The dock's left zone: everything that moves the session through time —
 * play/pause, reset, and recording, with tempo sitting immediately to its right
 * for the same reason. Heat-zone authoring and the other map tools live in the
 * centre slot's launcher, not here.
 */
export default function TransportCluster({
  running,
  options,
  isRecording,
  onStartRecording,
  onStopRecording,
  guardRequest,
  disabled = false,
  showRecord = true,
  showRun = true,
}: TransportClusterProps) {
  const handleStart = useCallback(
    () =>
      runWithToast(() => client.start(options), {
        success: "Simulation started",
        failure: "Failed to start simulation",
      }),
    [options]
  );
  const handleStop = useCallback(
    () =>
      runWithToast(() => client.stop(), {
        success: "Simulation paused",
        failure: "Failed to pause simulation",
      }),
    []
  );
  const handlePlayPause = useCallback(
    () => void (running ? handleStop() : handleStart()),
    [running, handleStart, handleStop]
  );
  const handleReset = useCallback(
    () =>
      guardRequest(
        () =>
          void runWithToast(() => client.reset(), {
            success: "Simulation reset",
            failure: "Failed to reset simulation",
          })
      ),
    [guardRequest]
  );

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  return (
    <div className="flex items-center gap-[3px] px-2">
      {showRun && (
        <>
          <IconButton
            onClick={handlePlayPause}
            disabled={disabled}
            className={running ? "text-status-ok" : "text-status-ok/90"}
            aria-label={running ? "Pause simulation" : "Start simulation"}
            title={running ? "Pause simulation" : "Start simulation"}
          >
            {running ? <Pause /> : <Play />}
          </IconButton>
          <IconButton
            onClick={handleReset}
            disabled={disabled}
            aria-label="Reset"
            title="Reset the simulation"
          >
            <Reset />
          </IconButton>
        </>
      )}
      {/* The key keeps its 36px whether it is armed or counting: the elapsed time
          replaces the glyph rather than growing beside it, because a control dock
          that widens mid-session slides every key under the operator's hand. The
          red pulse on the dock's hairline is the "still capturing" signal.

          A capture in progress keeps the key even where the activity would drop
          it — a recording nobody can stop from the dock is worse than one extra
          key on the bar. */}
      {(showRecord || isRecording) && (
        <IconButton
          onClick={() => void (isRecording ? onStopRecording() : onStartRecording())}
          disabled={disabled}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          title={
            isRecording ? `Recording — ${formatTime(elapsed)}. Click to stop` : "Start recording"
          }
          className={cn(isRecording && "text-status-error")}
        >
          {isRecording ? (
            <span className="font-mono text-[10.5px] font-semibold tabular-nums text-status-error">
              {formatTime(elapsed)}
            </span>
          ) : (
            <Record className="fill-current" />
          )}
        </IconButton>
      )}
    </div>
  );
}

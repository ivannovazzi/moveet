import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import type { SimulationStatus } from "@/types";
import { Pause, Play, Record, Reset } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import { toast, toErrorMessage } from "@/lib/toast";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast. Ported verbatim from the old `Controls/BottomDock.tsx`.
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

/** A 36×42 dock icon button (mockup `.ibtn`). */
function IconBtn({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[42px] w-9 items-center justify-center rounded-lg text-muted-foreground",
        "transition-[color,background-color] duration-fast ease-standard",
        "hover:bg-foreground/[0.035] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "[&_svg]:size-[17px]",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface PlaybackClusterProps {
  /** Recording state, owned by a single `useRecording()` call in `App.tsx`. */
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;
}

/**
 * The leftmost dock group: play/pause, reset, record. No panel — these are
 * one-click transport actions (mockup Playback group). Heat-zone authoring
 * lives in the Monitor panel's Heat Zones tab, not here (it is secondary).
 * Tracks the sim's `running` flag via `client.onStatus` (a multi-subscriber
 * event) rather than owning the WS lifecycle, which `useSimulationConnection`
 * keeps singular.
 */
export default function PlaybackCluster({
  isRecording,
  onStartRecording,
  onStopRecording,
}: PlaybackClusterProps) {
  const { options } = useOptions(300);

  const [running, setRunning] = useState(false);
  useEffect(() => {
    client.getStatus().then((res) => {
      if (res.data) setRunning(res.data.running);
    });
    const handleStatus = (data: SimulationStatus) => setRunning(data.running);
    client.onStatus(handleStatus);
    return () => client.offStatus(handleStatus);
  }, []);

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
    () => (running ? handleStop() : handleStart()),
    [running, handleStart, handleStop]
  );
  const handleReset = useCallback(
    () =>
      runWithToast(() => client.reset(), {
        success: "Simulation reset",
        failure: "Failed to reset simulation",
      }),
    []
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
      <IconBtn
        onClick={handlePlayPause}
        className={running ? "text-status-ok" : "text-status-ok/90"}
        aria-label={running ? "Pause simulation" : "Start simulation"}
        title={running ? "Pause simulation" : "Start simulation"}
      >
        {running ? <Pause /> : <Play />}
      </IconBtn>
      <IconBtn onClick={handleReset} aria-label="Reset" title="Reset">
        <Reset />
      </IconBtn>
      <IconBtn
        onClick={isRecording ? onStopRecording : onStartRecording}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        title={isRecording ? "Stop recording" : "Start recording"}
        className={cn("w-auto gap-1.5 px-2", isRecording && "text-status-error")}
      >
        <Record className={cn("fill-current", isRecording && "animate-pulse")} />
        {isRecording && (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-status-error">
            {formatTime(elapsed)}
          </span>
        )}
      </IconBtn>
    </div>
  );
}

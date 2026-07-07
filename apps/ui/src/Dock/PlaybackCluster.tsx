import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import type { SimulationStatus } from "@/types";
import { Flame, Pause, Play, Record, Reset } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import { Button, SquaredButton } from "@/components/Inputs";
import { toast, toErrorMessage } from "@/lib/toast";
import DockCluster from "./DockCluster";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast. Ported verbatim from `Controls/BottomDock.tsx`.
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

/** `mm:ss` formatting for the recording elapsed-time readout. */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface PlaybackClusterProps {
  /**
   * Whether this cluster's drawer is open. Accepted for interface parity
   * with the other dock clusters — `Dock.tsx` threads the same
   * `useDockNavigation` `{ isOpen, toggle, close }` triple down to every
   * cluster uniformly. Playback has no secondary content that needs a
   * drawer: reset and record are already single-click actions today (see
   * `Controls/BottomDock.tsx`), so per the design doc ("Always one click
   * away, no drawer needed for the common case") this cluster renders no
   * `DockDrawer` and this prop is unused.
   */
  isOpen: boolean;
  /** Unused — see `isOpen`. */
  onToggle: () => void;
  /** Unused — see `isOpen`. */
  onClose: () => void;
  /** Recording state, lifted from `App.tsx`'s single `useRecording()` call — the
   * Monitor drawer's Recordings tab reads the same hook instance, so calling it
   * again here would desync the two `isRecording` flags. */
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;
}

/**
 * Playback dock cluster: play/pause, reset, record, make-zones. Ported from
 * `Controls/BottomDock.tsx`'s always-visible button row (the replay-mode
 * dock is handled separately by `Dock.tsx`/`ReplayDock.tsx`).
 *
 * Self-contained: tracks the simulation's `running` flag itself via
 * `client.onStatus` — the same multi-subscriber event
 * `useSimulationConnection` (owned by `App.tsx`) also listens to — rather
 * than duplicating that hook's `connectWebSocket`/`disconnect` WS-lifecycle
 * ownership, which must stay singular.
 */
export default function PlaybackCluster({
  isOpen: _isOpen,
  onToggle: _onToggle,
  onClose: _onClose,
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
  const handleMakeZones = useCallback(
    () =>
      runWithToast(() => client.makeHeatzones(), {
        success: "Heat zones generated",
        failure: "Failed to generate heat zones",
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
    <div className="relative flex items-center gap-1">
      <DockCluster
        icon={running ? <Pause /> : <Play />}
        label="Playback"
        active={running}
        aria-label={running ? "Pause simulation" : "Start simulation"}
        onClick={handlePlayPause}
      />
      <SquaredButton
        icon={<Reset />}
        size="lg"
        variant="surface"
        onClick={handleReset}
        aria-label="Reset"
      />
      <SquaredButton
        icon={<Flame />}
        size="lg"
        variant="surface"
        onClick={handleMakeZones}
        aria-label="Make zones"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={isRecording ? onStopRecording : onStartRecording}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
        className={cn("gap-2", isRecording && "bg-status-error/15 hover:bg-status-error/25")}
      >
        <Record
          className={cn(
            "size-4",
            isRecording ? "fill-status-error animate-pulse" : "fill-muted-foreground"
          )}
        />
        {isRecording && (
          <span className="whitespace-nowrap text-xs tabular-nums text-status-error">
            {formatTime(elapsed)}
          </span>
        )}
      </Button>
    </div>
  );
}

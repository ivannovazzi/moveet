import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import type { ReplayStatus, SimulationStatus } from "@/types";
import { Flame, Pause, Play, Record, Reset, Stop } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import { useClock } from "@/hooks/useClock";
import { Button, SquaredButton } from "@/components/Inputs";
import { toast, toErrorMessage } from "@/lib/toast";

/**
 * Await an `ApiResponse`-returning client call and surface the outcome as a
 * toast. The client never rejects (it returns `{ error }`), but we still guard
 * against unexpected throws.
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

/* ── Dock container styling (glass overlay floating over the map) ── */

const DOCK_CLASS = cn(
  "absolute bottom-5 left-1/2 z-40 flex h-14 -translate-x-1/2 translate-y-3.5 items-center gap-5 px-6",
  "rounded-lg border border-border surface-glass shadow-elevated backdrop-blur-md",
  "pointer-events-none opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

/* ── Replay helpers (ported from ReplayBar.tsx) ── */

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useInterpolatedProgress(replayStatus: ReplayStatus) {
  const duration = replayStatus.duration ?? 0;
  const serverTime = replayStatus.currentTime ?? 0;
  const speed = replayStatus.speed ?? 1;
  const isPlaying = replayStatus.mode === "replay" && !replayStatus.paused;

  const [displayTime, setDisplayTime] = useState(serverTime);
  const anchorRef = useRef({ serverTime, wall: Date.now() });

  useEffect(() => {
    anchorRef.current = { serverTime, wall: Date.now() };
    setDisplayTime(serverTime);
  }, [serverTime]);

  useEffect(() => {
    if (!isPlaying || duration <= 0) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - anchorRef.current.wall;
      const interpolated = anchorRef.current.serverTime + elapsed * speed;
      setDisplayTime(Math.min(interpolated, duration));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, speed, duration]);

  const progress = duration > 0 ? Math.min(displayTime / duration, 1) : 0;
  return { displayTime, progress, duration };
}

const SPEEDS = [1, 2, 4] as const;

// Compact port of ClockPanel's SPEED_PRESETS button row — just the presets,
// not the log-scale slider (that stays out of scope for the dock).
const SIM_SPEED_PRESETS = [
  { label: "1×", value: 1 },
  { label: "60×", value: 60 },
  { label: "360×", value: 360 },
  { label: "3600×", value: 3600 },
] as const;

/* ── Replay Dock (private) ── */

interface ReplayDockProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
}

function ReplayDock({
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
}: ReplayDockProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const { displayTime, progress, duration } = useInterpolatedProgress(replayStatus);

  const handlePlayPause = useCallback(async () => {
    if (replayStatus.paused) {
      await onResumeReplay();
    } else {
      await onPauseReplay();
    }
  }, [replayStatus.paused, onPauseReplay, onResumeReplay]);

  const handleProgressClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || duration <= 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const timestamp = (clickX / rect.width) * duration;
      await onSeekReplay(timestamp);
    },
    [duration, onSeekReplay]
  );

  const handleSpeedChange = useCallback(
    async (speed: number) => {
      await onSetReplaySpeed(speed);
    },
    [onSetReplaySpeed]
  );

  const fileName = replayStatus.file?.split("/").pop();

  return (
    <div className={DOCK_CLASS}>
      <span
        className="max-w-[140px] shrink-0 truncate text-sm text-muted-foreground"
        title={fileName}
      >
        {fileName}
      </span>

      <div className="flex shrink-0 items-center gap-px">
        <SquaredButton
          icon={replayStatus.paused ? <Play /> : <Pause />}
          size="lg"
          variant="surface"
          onClick={handlePlayPause}
          aria-label={replayStatus.paused ? "Resume" : "Pause"}
        />
        <SquaredButton
          icon={<Stop />}
          size="lg"
          variant="surface"
          tone="danger"
          onClick={onStopReplay}
          aria-label="Stop replay"
        />
      </div>

      <div
        ref={progressRef}
        className="group relative flex h-10 min-w-[100px] flex-[0_1_320px] cursor-pointer items-center"
        onClick={handleProgressClick}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted transition-[height] group-hover:h-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
        {formatTime(displayTime / 1000)} / {formatTime(duration / 1000)}
      </span>

      <div className="flex shrink-0 gap-px">
        {SPEEDS.map((s) => (
          <Button
            key={s}
            variant={(replayStatus.speed ?? 1) === s ? "default" : "ghost"}
            size="sm"
            className="font-medium"
            onClick={() => handleSpeedChange(s)}
          >
            {s}x
          </Button>
        ))}
      </div>
    </div>
  );
}

/* ── Main Dock ── */

interface BottomDockProps {
  status: SimulationStatus;
  connected: boolean;
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;
}

export default function BottomDock({
  status,
  connected,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
  isRecording,
  onStartRecording,
  onStopRecording,
}: BottomDockProps) {
  const { options } = useOptions(300);
  const { clock, setSpeedMultiplier } = useClock();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const clockTimeStr = new Date(clock.currentTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

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

  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  if (replayStatus.mode === "replay") {
    return (
      <ReplayDock
        replayStatus={replayStatus}
        onPauseReplay={onPauseReplay}
        onResumeReplay={onResumeReplay}
        onStopReplay={onStopReplay}
        onSeekReplay={onSeekReplay}
        onSetReplaySpeed={onSetReplaySpeed}
      />
    );
  }

  const statusChips = [
    { key: "ws", label: "WS", active: connected },
    { key: "sim", label: "SIM", active: status.running },
  ] as const;

  return (
    <div className={DOCK_CLASS}>
      <div className="flex items-center gap-1">
        <SquaredButton
          onClick={status.running ? handleStop : handleStart}
          icon={status.running ? <Pause /> : <Play />}
          size="lg"
          variant="surface"
          tone="success"
          active={status.running}
          aria-label={status.running ? "Pause" : "Start"}
        />
        <SquaredButton
          onClick={handleReset}
          icon={<Reset />}
          size="lg"
          variant="surface"
          aria-label="Reset"
        />
        <SquaredButton
          onClick={handleMakeZones}
          icon={<Flame />}
          size="lg"
          variant="surface"
          aria-label="Make zones"
        />
      </div>

      <div className="flex shrink-0 items-center gap-px" role="group" aria-label="Simulation speed">
        {SIM_SPEED_PRESETS.map(({ label, value }) => (
          <Button
            key={value}
            variant={clock.speedMultiplier === value ? "default" : "ghost"}
            size="sm"
            className="font-medium"
            onClick={() => setSpeedMultiplier(value)}
          >
            {label}
          </Button>
        ))}
      </div>

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

      <span
        className="shrink-0 whitespace-nowrap font-mono text-sm tabular-nums text-muted-foreground"
        title="Simulation clock"
      >
        {clockTimeStr}
      </span>

      <div className="flex items-center gap-1">
        {statusChips.map(({ key, label, active }) => (
          <span
            key={key}
            className={cn(
              "inline-flex items-center gap-2 px-2 text-xs",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                active
                  ? "bg-status-ok shadow-[0_0_4px_var(--color-status-ok)]"
                  : "bg-muted-foreground"
              )}
            />
            <span className={cn("uppercase tracking-wider", active ? "opacity-85" : "opacity-55")}>
              {label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

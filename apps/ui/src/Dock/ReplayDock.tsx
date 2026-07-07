import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ReplayStatus } from "@/types";
import { Pause, Play, Stop } from "@/components/Icons";
import { Button, SquaredButton } from "@/components/Inputs";

/* ── Dock container styling, matching `Dock.tsx`'s glass/blur/shadow treatment ── */

const DOCK_CLASS = cn(
  "absolute bottom-5 left-1/2 z-40 flex h-14 -translate-x-1/2 translate-y-3.5 items-center gap-5 px-6",
  "rounded-lg border border-border surface-glass shadow-elevated backdrop-blur-md",
  "pointer-events-none opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

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

export interface ReplayDockProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
}

/**
 * Replaces the entire dock while a recording is being replayed, ported
 * verbatim from `Controls/BottomDock.tsx`'s private `ReplayDock`. `Dock.tsx`
 * renders this instead of its normal 5-cluster bar whenever
 * `replayStatus.mode === "replay"` — matching the old swap behavior exactly.
 */
export default function ReplayDock({
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

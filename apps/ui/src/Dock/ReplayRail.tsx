import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ReplayStatus } from "@/types";
import { Pause, Play, Stop } from "@/components/Icons";
import { Slider } from "@/components/ui/slider";
import { IconButton, RailLabel } from "./DockBarKit";

const SPEEDS = [1, 2, 4] as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Server time ticks arrive about once a second; interpolate between them so the
 * readout counts smoothly at the current replay speed instead of stepping.
 * Ported from the old `ReplayDock`, unchanged apart from its home.
 */
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

  return { displayTime, duration };
}

export interface ReplayRailProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;
}

/**
 * The work dock during a replay. It used to be `ReplayDock`, a separate bar that
 * replaced the whole dock — which also took away the tempo control, all four
 * panel clusters and the status chips for the length of the playback. Living in
 * the work dock keeps the rest of the dock reachable while a recording plays,
 * and puts the playback where every other "what the map is doing" state is.
 */
export default function ReplayRail({
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
}: ReplayRailProps) {
  const { displayTime, duration } = useInterpolatedProgress(replayStatus);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const handlePlayPause = useCallback(() => {
    void (replayStatus.paused ? onResumeReplay() : onPauseReplay());
  }, [replayStatus.paused, onPauseReplay, onResumeReplay]);

  // Seek on commit only — a seek per drag frame would flood the simulator.
  const handleCommit = useCallback(
    ([value]: number[]) => {
      setScrubbing(null);
      void onSeekReplay(value);
    },
    [onSeekReplay]
  );

  const fileName = replayStatus.file?.split("/").pop() ?? "recording";
  const position = scrubbing ?? displayTime;
  const speed = replayStatus.speed ?? 1;

  return (
    <div className="flex h-[42px] min-w-0 items-center gap-2 pl-2.5 pr-0.5">
      <span className="flex shrink-0 items-center gap-1.5 text-accent">
        <RailLabel>Replay</RailLabel>
      </span>

      <span
        className="hidden max-w-[110px] shrink truncate text-[11.5px] text-muted-foreground xl:block"
        title={fileName}
      >
        {fileName}
      </span>

      <IconButton
        onClick={handlePlayPause}
        className="w-7"
        aria-label={replayStatus.paused ? "Resume replay" : "Pause replay"}
        title={replayStatus.paused ? "Resume replay" : "Pause replay"}
      >
        {replayStatus.paused ? <Play /> : <Pause />}
      </IconButton>

      <Slider
        min={0}
        max={Math.max(duration, 1)}
        step={1000}
        value={[Math.min(position, duration)]}
        onValueChange={([v]) => setScrubbing(v)}
        onValueCommit={handleCommit}
        aria-label="Replay position"
        // The rail sizes to its content now, so the track carries its own width
        // instead of stretching into a slot.
        className="w-[150px] shrink xl:w-[210px]"
      />

      <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatTime(position / 1000)} / {formatTime(duration / 1000)}
      </span>

      <div className="flex shrink-0 items-center gap-px" role="group" aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => void onSetReplaySpeed(s)}
            className={cn(
              "h-7 rounded-md px-1.5 font-mono text-[11px] font-semibold tabular-nums",
              "transition-colors duration-fast ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              speed === s
                ? "bg-accent/18 text-accent"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
            )}
          >
            {s}×
          </button>
        ))}
      </div>

      <IconButton
        onClick={() => void onStopReplay()}
        className="w-7 text-status-error hover:bg-status-error/10 hover:text-status-error"
        aria-label="Stop replay"
        title="Stop replay and return to the live simulation"
      >
        <Stop />
      </IconButton>
    </div>
  );
}

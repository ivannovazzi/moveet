import { useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import type { ReplayStatus } from "@/types";
import { Play, Pause, Stop } from "@/components/Icons";
import styles from "./ReplayBar.module.css";

interface ReplayBarProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Client-side interpolated progress. Uses server-provided currentTime as
 * anchor and locally advances it every second while playing, so the
 * progress bar animates smoothly between server events.
 */
function useInterpolatedProgress(replayStatus: ReplayStatus) {
  const duration = replayStatus.duration ?? 0;
  const serverTime = replayStatus.currentTime ?? 0;
  const speed = replayStatus.speed ?? 1;
  const isPlaying = replayStatus.mode === "replay" && !replayStatus.paused;

  const [displayTime, setDisplayTime] = useState(serverTime);
  const anchorRef = useRef({ serverTime, wall: Date.now() });

  // Reset anchor when server sends a new position
  useEffect(() => {
    anchorRef.current = { serverTime, wall: Date.now() };
    setDisplayTime(serverTime);
  }, [serverTime]);

  // Tick every second while playing
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

export default function ReplayBar({
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
}: ReplayBarProps) {
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
      const barWidth = rect.width;
      const timestamp = (clickX / barWidth) * duration;
      await onSeekReplay(timestamp);
    },
    [duration, onSeekReplay]
  );

  const handleSpeedChange = useCallback(
    async (speed: number) => {
      if (replayStatus.file) {
        await onStartReplay(replayStatus.file, speed);
      }
    },
    [replayStatus.file, onStartReplay]
  );

  // Show friendly filename
  const fileName = replayStatus.file?.replace(/^recordings\//, "");

  return (
    <div className={styles.bar}>
      <span className={styles.fileName} title={fileName}>
        {fileName}
      </span>

      <button
        type="button"
        className={styles.transportBtn}
        onClick={handlePlayPause}
        aria-label={replayStatus.paused ? "Resume" : "Pause"}
      >
        {replayStatus.paused ? (
          <Play className={styles.transportIcon} />
        ) : (
          <Pause className={styles.transportIcon} />
        )}
      </button>

      <button
        type="button"
        className={styles.stopBtn}
        onClick={onStopReplay}
        aria-label="Stop replay"
      >
        <Stop className={styles.transportIcon} />
      </button>

      <div
        ref={progressRef}
        className={styles.progressWrap}
        onClick={handleProgressClick}
      >
        <div
          className={styles.progressFill}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <span className={styles.time}>
        {formatTime(displayTime / 1000)} / {formatTime(duration / 1000)}
      </span>

      <div className={styles.speedGroup}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={classNames(styles.speedBtn, {
              [styles.speedBtnActive]: (replayStatus.speed ?? 1) === s,
            })}
            onClick={() => handleSpeedChange(s)}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

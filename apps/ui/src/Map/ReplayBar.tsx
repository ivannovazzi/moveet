import { useCallback, useRef } from "react";
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

  const duration = replayStatus.duration ?? 0;
  const currentTime = replayStatus.currentTime ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;

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

  return (
    <div className={styles.bar}>
      <span className={styles.fileName} title={replayStatus.file}>
        {replayStatus.file}
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
        {formatTime(currentTime / 1000)} / {formatTime(duration / 1000)}
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

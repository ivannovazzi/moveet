import { useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import client from "@/utils/client";
import type { ReplayStatus, SimulationStatus } from "@/types";
import { Flame, Pause, Play, Reset, Stop } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import styles from "./BottomDock.module.css";

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

/* ── Replay Dock (private) ── */

interface ReplayDockProps {
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

function ReplayDock({
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
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
      if (replayStatus.file) {
        await onStartReplay(replayStatus.file, speed);
      }
    },
    [replayStatus.file, onStartReplay]
  );

  const fileName = replayStatus.file?.replace(/^recordings\//, "");

  return (
    <div className={styles.dock}>
      <span className={styles.fileName} title={fileName}>{fileName}</span>

      <div className={styles.transportGroup}>
        <button
          type="button"
          className={styles.dockBtn}
          onClick={handlePlayPause}
          aria-label={replayStatus.paused ? "Resume" : "Pause"}
        >
          {replayStatus.paused ? (
            <Play className={styles.btnIcon} />
          ) : (
            <Pause className={styles.btnIcon} />
          )}
        </button>
        <button
          type="button"
          className={styles.stopBtn}
          onClick={onStopReplay}
          aria-label="Stop replay"
        >
          <Stop className={styles.btnIcon} />
        </button>
      </div>

      <div className={styles.divider} />

      <div ref={progressRef} className={styles.progressWrap} onClick={handleProgressClick}>
        <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
      </div>

      <span className={styles.time}>
        {formatTime(displayTime / 1000)} / {formatTime(duration / 1000)}
      </span>

      <div className={styles.divider} />

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

/* ── Main Dock ── */

interface BottomDockProps {
  status: SimulationStatus;
  connected: boolean;
  vehicleCount: number;
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

export default function BottomDock({
  status,
  connected,
  vehicleCount,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
}: BottomDockProps) {
  const { options } = useOptions(300);

  const handleStart = useCallback(() => client.start(options), [options]);
  const handleReset = useCallback(async () => { await client.reset(); }, []);

  if (replayStatus.mode === "replay") {
    return (
      <ReplayDock
        replayStatus={replayStatus}
        onPauseReplay={onPauseReplay}
        onResumeReplay={onResumeReplay}
        onStopReplay={onStopReplay}
        onSeekReplay={onSeekReplay}
        onStartReplay={onStartReplay}
      />
    );
  }

  const statusChips = [
    { key: "ws", label: "WS", active: connected },
    { key: "sim", label: "SIM", active: status.running },
  ] as const;

  return (
    <div className={styles.dock}>
      <div className={styles.group}>
        <button
          type="button"
          onClick={status.running ? client.stop : handleStart}
          className={classNames(styles.dockBtn, { [styles.dockBtnActive]: status.running })}
          aria-label={status.running ? "Pause" : "Start"}
        >
          {status.running ? <Pause className={styles.btnIcon} /> : <Play className={styles.btnIcon} />}
        </button>
        <button type="button" onClick={handleReset} className={styles.dockBtn} aria-label="Reset">
          <Reset className={styles.btnIcon} />
        </button>
        <button type="button" onClick={client.makeHeatzones} className={styles.dockBtn} aria-label="Make zones">
          <Flame className={styles.btnIcon} />
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group}>
        {statusChips.map(({ key, label, active }) => (
          <span key={key} className={classNames(styles.chip, { [styles.chipActive]: active })}>
            <span className={classNames(styles.led, { [styles.ledOn]: active })} />
            <span className={styles.chipLabel}>{label}</span>
          </span>
        ))}
      </div>

      <div className={styles.divider} />

      <span className={styles.vehicleCount}>
        <span className={styles.vehicleCountValue}>{vehicleCount}</span>
        <span className={styles.vehicleCountLabel}>fleet</span>
      </span>
    </div>
  );
}

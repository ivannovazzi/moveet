import { useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import client from "@/utils/client";
import type { ReplayStatus, SimulationStatus } from "@/types";
import { Flame, Pause, Play, Record, Reset, Stop } from "@/components/Icons";
import { useOptions } from "@/hooks/useOptions";
import { SquaredButton } from "@/components/Inputs";
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

  const fileName = replayStatus.file?.replace(/^recordings\//, "");

  return (
    <div className={styles.dock}>
      <span className={styles.fileName} title={fileName}>
        {fileName}
      </span>

      <div className={styles.transportGroup}>
        <SquaredButton
          className={styles.dockBtn}
          icon={replayStatus.paused ? <Play /> : <Pause />}
          iconClassName={styles.btnIcon}
          size="lg"
          variant="surface"
          onClick={handlePlayPause}
          aria-label={replayStatus.paused ? "Resume" : "Pause"}
        />
        <SquaredButton
          className={styles.dockBtn}
          icon={<Stop />}
          iconClassName={styles.btnIcon}
          size="lg"
          variant="surface"
          tone="danger"
          onClick={onStopReplay}
          aria-label="Stop replay"
        />
      </div>

      <div className={styles.divider} />

      <div ref={progressRef} className={styles.progressWrap} onClick={handleProgressClick}>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
        </div>
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
  onSetReplaySpeed: (speed: number) => Promise<void>;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;
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
  onSetReplaySpeed,
  isRecording,
  onStartRecording,
  onStopRecording,
}: BottomDockProps) {
  const { options } = useOptions(300);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const handleStart = useCallback(() => client.start(options), [options]);
  const handleReset = useCallback(async () => {
    await client.reset();
  }, []);

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
    <div className={styles.dock}>
      <div className={styles.group}>
        <SquaredButton
          onClick={status.running ? client.stop : handleStart}
          className={styles.dockBtn}
          icon={status.running ? <Pause /> : <Play />}
          iconClassName={styles.btnIcon}
          size="lg"
          variant="surface"
          tone="success"
          active={status.running}
          aria-label={status.running ? "Pause" : "Start"}
        />
        <SquaredButton
          onClick={handleReset}
          className={styles.dockBtn}
          icon={<Reset />}
          iconClassName={styles.btnIcon}
          size="lg"
          variant="surface"
          aria-label="Reset"
        />
        <SquaredButton
          onClick={client.makeHeatzones}
          className={styles.dockBtn}
          icon={<Flame />}
          iconClassName={styles.btnIcon}
          size="lg"
          variant="surface"
          aria-label="Make zones"
        />
      </div>

      <div className={styles.divider} />

      <button
        type="button"
        className={classNames(styles.recordBtn, { [styles.recordBtnActive]: isRecording })}
        onClick={isRecording ? onStopRecording : onStartRecording}
        aria-label={isRecording ? "Stop recording" : "Start recording"}
      >
        <Record className={styles.recordIcon} />
        {isRecording && <span className={styles.recordTime}>{formatTime(elapsed)}</span>}
      </button>

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

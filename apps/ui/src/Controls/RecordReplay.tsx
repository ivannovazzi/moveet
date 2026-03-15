import { useState, useEffect, useRef, useCallback } from "react";
import classNames from "classnames";
import type { RecordingFile, ReplayStatus } from "@/types";
import { Stop, Record, Play, Pause } from "@/components/Icons";
import styles from "./RecordReplay.module.css";

interface RecordingHook {
  isRecording: boolean;
  recordings: RecordingFile[];
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<unknown>;
  refreshRecordings: () => Promise<void>;
}

interface RecordReplayProps {
  recording: RecordingHook;
  replayStatus: ReplayStatus;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
}

/** Recordings smaller than this are header-only (no events). */
const MIN_PLAYABLE_SIZE = 300;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Extract vehicle count from filename like "moveet-...-20v.ndjson" */
function parseVehicleCount(fileName: string): number | null {
  const match = fileName.match(/(\d+)v\.ndjson$/);
  return match ? Number(match[1]) : null;
}

function formatLabel(file: RecordingFile): string {
  const count = parseVehicleCount(file.fileName);
  const date = formatDate(file.modifiedAt);
  return count ? `${count} vehicles \u2014 ${date}` : date;
}

/**
 * Client-side interpolated progress. Uses server-provided currentTime as
 * anchor and locally advances it every second while playing.
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

export default function RecordReplay({
  recording,
  replayStatus,
  onStartReplay,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
}: RecordReplayProps) {
  const { isRecording, recordings, startRecording, stopRecording } = recording;

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isReplayMode = replayStatus.mode === "replay";
  const isPaused = replayStatus.paused ?? false;
  // Server returns path like "recordings/file.ndjson", recordings list has just "file.ndjson"
  const activeFile = replayStatus.file?.replace(/^recordings\//, "") ?? null;

  const { displayTime, progress, duration } = useInterpolatedProgress(replayStatus);

  // Elapsed timer for recording
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const handleRecordToggle = useCallback(async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleFileClick = useCallback(
    async (file: RecordingFile) => {
      if (file.fileSize < MIN_PLAYABLE_SIZE) return;
      await onStartReplay(file.fileName, 1);
    },
    [onStartReplay]
  );

  const handlePlayPause = useCallback(async () => {
    if (isPaused) {
      await onResumeReplay();
    } else {
      await onPauseReplay();
    }
  }, [isPaused, onPauseReplay, onResumeReplay]);

  const playableRecordings = recordings.filter((f) => f.fileSize >= MIN_PLAYABLE_SIZE);

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>Recordings</h2>
      </div>

      <div className={styles.body}>
        {/* Record section */}
        <div className={styles.recordRow}>
          <button
            type="button"
            className={classNames(styles.recordButton, {
              [styles.recordButtonActive]: isRecording,
            })}
            onClick={handleRecordToggle}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? (
              <>
                <span className={classNames(styles.recordDot, styles.recordDotActive)} />
                <Stop className={styles.recordIcon} />
                Stop
              </>
            ) : (
              <>
                <span className={styles.recordDot} />
                <Record className={styles.recordIcon} />
                Record
              </>
            )}
          </button>
          {isRecording && <span className={styles.elapsed}>{formatTime(elapsed)}</span>}
        </div>

        {/* List header */}
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>Saved</span>
        </div>

        {playableRecordings.length === 0 ? (
          <div className={styles.empty}>No recordings yet</div>
        ) : (
          <div className={styles.recordingList}>
            {playableRecordings.map((file) => {
              const isActive = isReplayMode && activeFile === file.fileName;

              return (
                <div
                  key={file.fileName}
                  className={classNames(styles.recordingItem, {
                    [styles.recordingItemActive]: isActive,
                  })}
                  onClick={() => !isActive && handleFileClick(file)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (!isActive) handleFileClick(file);
                    }
                  }}
                >
                  <div className={styles.recordingInfo}>
                    <div className={styles.recordingName} title={file.fileName}>
                      {formatLabel(file)}
                    </div>
                    <div className={styles.recordingMeta}>
                      <span>{formatFileSize(file.fileSize)}</span>
                      {isActive && (
                        <span className={styles.playingLabel}>
                          {isPaused ? "Paused" : "Playing"}
                        </span>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div className={styles.replayControls}>
                      <button
                        type="button"
                        className={styles.transportBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayPause();
                        }}
                        aria-label={isPaused ? "Resume" : "Pause"}
                      >
                        {isPaused ? (
                          <Play className={styles.transportIcon} />
                        ) : (
                          <Pause className={styles.transportIcon} />
                        )}
                      </button>
                      <button
                        type="button"
                        className={styles.stopBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopReplay();
                        }}
                        aria-label="Stop replay"
                      >
                        <Stop className={styles.transportIcon} />
                      </button>
                    </div>
                  )}

                  {isActive && (
                    <div className={styles.progressRow}>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                      <span className={styles.progressTime}>
                        {formatTime(displayTime / 1000)} / {formatTime(duration / 1000)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

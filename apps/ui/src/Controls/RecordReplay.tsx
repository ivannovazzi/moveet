import { useState, useEffect, useRef, useCallback } from "react";
import classNames from "classnames";
import type { RecordingFile, ReplayStatus } from "@/types";
import { Play, Pause, Stop, Record } from "@/components/Icons";
import styles from "./RecordReplay.module.css";

interface RecordingHook {
  isRecording: boolean;
  recordings: RecordingFile[];
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<unknown>;
  refreshRecordings: () => Promise<void>;
}

interface ReplayHook {
  replayStatus: ReplayStatus;
  startReplay: (file: string, speed?: number) => Promise<void>;
  pauseReplay: () => Promise<void>;
  resumeReplay: () => Promise<void>;
  stopReplay: () => Promise<void>;
  seekReplay: (timestamp: number) => Promise<void>;
}

interface RecordReplayProps {
  recording: RecordingHook;
  replay: ReplayHook;
}

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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SPEEDS = [1, 2, 4] as const;

export default function RecordReplay({ recording, replay }: RecordReplayProps) {
  const { isRecording, recordings, startRecording, stopRecording } = recording;
  const { replayStatus, startReplay, pauseReplay, resumeReplay, stopReplay } = replay;

  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      await startReplay(file.fileName, 1);
    },
    [startReplay]
  );

  const handleSpeedChange = useCallback(
    async (speed: number) => {
      if (replayStatus.file) {
        await startReplay(replayStatus.file, speed);
      }
    },
    [replayStatus.file, startReplay]
  );

  const handlePlayPause = useCallback(async () => {
    if (replayStatus.paused) {
      await resumeReplay();
    } else {
      await pauseReplay();
    }
  }, [replayStatus.paused, pauseReplay, resumeReplay]);

  const inReplay = replayStatus.mode === "replay";

  return (
    <div className={styles.section}>
      {/* ── Recording ── */}
      <div className={styles.sectionHeader}>
        <span className={styles.title}>Record</span>
      </div>

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

      {/* ── Recordings list ── */}
      <div className={styles.sectionHeader} style={{ marginTop: "var(--space-5)" }}>
        <span className={styles.title}>Recordings</span>
      </div>

      {recordings.length === 0 ? (
        <div className={styles.empty}>No recordings yet</div>
      ) : (
        <div className={styles.recordingList}>
          {recordings.map((file) => (
            <div
              key={file.fileName}
              className={classNames(styles.recordingItem, {
                [styles.recordingItemActive]: inReplay && replayStatus.file === file.fileName,
              })}
              onClick={() => handleFileClick(file)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleFileClick(file);
              }}
            >
              <div className={styles.recordingInfo}>
                <div className={styles.recordingName} title={file.fileName}>
                  {file.fileName}
                </div>
                <div className={styles.recordingMeta}>
                  <span>{formatFileSize(file.fileSize)}</span>
                  <span>{formatDate(file.modifiedAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Playback controls (only shown in replay mode) ── */}
      {inReplay && (
        <div className={styles.playbackSection}>
          <div className={styles.playbackHeader}>
            <span className={styles.playbackTitle}>Replay</span>
            <span className={styles.playbackFile} title={replayStatus.file}>
              {replayStatus.file}
            </span>
          </div>

          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${(replayStatus.progress ?? 0) * 100}%` }}
            />
          </div>

          <div className={styles.timeRow}>
            <span>{formatTime(replayStatus.currentTime ?? 0)}</span>
            <span>{formatTime(replayStatus.duration ?? 0)}</span>
          </div>

          <div className={styles.transportRow}>
            <button
              type="button"
              className={styles.transportButton}
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
              className={styles.stopButton}
              onClick={stopReplay}
              aria-label="Stop replay"
            >
              <Stop className={styles.transportIcon} />
            </button>

            <div className={styles.speedGroup}>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={classNames(styles.speedButton, {
                    [styles.speedButtonActive]: (replayStatus.speed ?? 1) === s,
                  })}
                  onClick={() => handleSpeedChange(s)}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

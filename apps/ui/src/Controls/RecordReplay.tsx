import { useState, useEffect, useRef, useCallback } from "react";
import classNames from "classnames";
import type { RecordingFile } from "@/types";
import { Stop, Record } from "@/components/Icons";
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
  onStartReplay: (file: string, speed?: number) => Promise<void>;
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

export default function RecordReplay({ recording, onStartReplay }: RecordReplayProps) {
  const { isRecording, recordings, startRecording, stopRecording } = recording;

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
      await onStartReplay(file.fileName, 1);
    },
    [onStartReplay]
  );

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

        {recordings.length === 0 ? (
          <div className={styles.empty}>No recordings yet</div>
        ) : (
          <div className={styles.recordingList}>
            {recordings.map((file) => (
              <div
                key={file.fileName}
                className={styles.recordingItem}
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
      </div>
    </>
  );
}

import type { RecordingFile, ReplayStatus } from "@/types";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelHeader,
  PanelSectionLabel,
} from "./PanelPrimitives";
import styles from "./RecordReplay.module.css";
import { Button } from "react-aria-components";
import classNames from "classnames";

interface RecordReplayProps {
  recordings: RecordingFile[];
  replayStatus: ReplayStatus;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
}

/** Recordings smaller than this are header-only (no events). */
const MIN_PLAYABLE_SIZE = 300;

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

export default function RecordReplay({
  recordings,
  replayStatus,
  onStartReplay,
}: RecordReplayProps) {
  const isReplayMode = replayStatus.mode === "replay";
  const isPaused = replayStatus.paused ?? false;
  // Server returns path like "recordings/file.ndjson", recordings list has just "file.ndjson"
  const activeFile = replayStatus.file?.replace(/^recordings\//, "") ?? null;

  const playableRecordings = recordings.filter((f) => f.fileSize >= MIN_PLAYABLE_SIZE);

  return (
    <>
      <PanelHeader
        title="Recordings"
        subtitle={
          playableRecordings.length === 0
            ? "Capture and replay simulator sessions."
            : `${playableRecordings.length} saved capture${playableRecordings.length === 1 ? "" : "s"} ready to replay`
        }
        badge={<PanelBadge>{playableRecordings.length}</PanelBadge>}
      />

      <PanelBody className={styles.body}>
        <div className={styles.listHeader}>
          <PanelSectionLabel>Saved</PanelSectionLabel>
        </div>

        {playableRecordings.length === 0 ? (
          <PanelEmptyState>No recordings yet</PanelEmptyState>
        ) : (
          <div className={styles.recordingList}>
            {playableRecordings.map((file) => {
              const isActive = isReplayMode && activeFile === file.fileName;

              return (
                <Button
                  key={file.fileName}
                  className={classNames(styles.recordingItem, {
                    [styles.recordingItemActive]: isActive,
                  })}
                  onPress={() => !isActive && onStartReplay(file.fileName, 1)}
                  isDisabled={isActive}
                  aria-label={`Play recording ${formatLabel(file)}`}
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
                </Button>
              );
            })}
          </div>
        )}
      </PanelBody>
    </>
  );
}

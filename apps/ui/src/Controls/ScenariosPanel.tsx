import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import classNames from "classnames";
import client from "@/utils/client";
import type { ScenarioFile, ScenarioStatus, ScenarioEventPayload } from "@/types";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelHeader,
  PanelSectionLabel,
} from "./PanelPrimitives";
import { Play, Pause, Stop } from "@/components/Icons";
import styles from "./ScenariosPanel.module.css";

interface LogEntry {
  time: number;
  type: string;
  detail?: string;
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

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ScenariosPanel() {
  const [scenarios, setScenarios] = useState<ScenarioFile[]>([]);
  const [status, setStatus] = useState<ScenarioStatus>({
    state: "idle",
    scenario: null,
    elapsed: 0,
    eventIndex: 0,
    eventsExecuted: 0,
    upcomingEvents: [],
  });
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Fetch scenario list ────────────────────────────────────────
  const fetchScenarios = useCallback(() => {
    client.getScenarios().then((res) => {
      if (res.data) setScenarios(res.data);
    });
  }, []);

  const fetchStatus = useCallback(() => {
    client.getScenarioStatus().then((res) => {
      if (res.data) setStatus(res.data);
    });
  }, []);

  useEffect(() => {
    fetchScenarios();
    fetchStatus();
  }, [fetchScenarios, fetchStatus]);

  // ─── Poll status when running/paused ────────────────────────────
  useEffect(() => {
    if (status.state === "running" || status.state === "paused") {
      pollRef.current = setInterval(fetchStatus, 1000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status.state, fetchStatus]);

  // ─── WebSocket events for event log ─────────────────────────────
  useEffect(() => {
    const handler = (data: ScenarioEventPayload) => {
      const entry: LogEntry = {
        time: data.at ?? data.elapsed ?? 0,
        type: data.type ?? data.action?.type ?? "unknown",
        detail: data.name,
      };
      setEventLog((prev) => {
        const next = [entry, ...prev];
        return next.length > 100 ? next.slice(0, 100) : next;
      });

      // If scenario completed or stopped, refresh status
      if (data.type === "scenario:completed" || data.type === "scenario:stopped") {
        fetchStatus();
      }
    };

    client.onScenarioEvent(handler);
    return () => {
      client.offScenarioEvent();
    };
  }, [fetchStatus]);

  // ─── Actions ────────────────────────────────────────────────────
  const loadScenario = useCallback(
    async (fileName: string) => {
      setLoading(fileName);
      const res = await client.loadScenarioByName(fileName);
      setLoading(null);
      if (res.data) {
        fetchStatus();
        setEventLog([]);
      }
    },
    [fetchStatus]
  );

  const startScenario = useCallback(async () => {
    const res = await client.startScenario();
    if (res.data) {
      setStatus(res.data);
      setEventLog([]);
    }
  }, []);

  const pauseScenario = useCallback(async () => {
    const res = await client.pauseScenario();
    if (res.data) setStatus(res.data);
  }, []);

  const stopScenario = useCallback(async () => {
    const res = await client.stopScenario();
    if (res.data) {
      setStatus(res.data);
      setEventLog([]);
    }
  }, []);

  const hasScenario = status.scenario !== null;
  const isRunning = status.state === "running";
  const isPaused = status.state === "paused";
  const isActive = isRunning || isPaused;
  const duration = status.scenario?.duration ?? 0;
  const progress = duration > 0 ? Math.min((status.elapsed / duration) * 100, 100) : 0;

  return (
    <>
      <PanelHeader
        title="Scenarios"
        subtitle={
          scenarios.length === 0
            ? "Orchestrate scripted simulation events."
            : `${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} available`
        }
        badge={<PanelBadge>{scenarios.length}</PanelBadge>}
      />

      <PanelBody className={styles.body}>
        {/* ── Loaded scenario info + controls ── */}
        {hasScenario && (
          <>
            <div className={styles.loadedInfo}>
              <div className={styles.loadedName}>{status.scenario!.name}</div>
              <div className={styles.loadedMeta}>
                <span>{status.scenario!.eventCount} events</span>
                <span>{formatSeconds(status.scenario!.duration)}</span>
                <span
                  className={classNames(styles.stateLabel, {
                    [styles.stateRunning]: isRunning,
                    [styles.statePaused]: isPaused,
                    [styles.stateIdle]: status.state === "idle",
                  })}
                >
                  {status.state}
                </span>
              </div>
            </div>

            <div className={styles.controls}>
              {status.state === "idle" && (
                <Button
                  className={classNames(styles.controlButton, styles.controlButtonPrimary)}
                  onPress={startScenario}
                  aria-label="Start scenario"
                >
                  <Play className={styles.controlIcon} />
                  Start
                </Button>
              )}
              {isRunning && (
                <Button
                  className={styles.controlButton}
                  onPress={pauseScenario}
                  aria-label="Pause scenario"
                >
                  <Pause className={styles.controlIcon} />
                  Pause
                </Button>
              )}
              {isPaused && (
                <Button
                  className={classNames(styles.controlButton, styles.controlButtonPrimary)}
                  onPress={startScenario}
                  aria-label="Resume scenario"
                >
                  <Play className={styles.controlIcon} />
                  Resume
                </Button>
              )}
              {isActive && (
                <Button
                  className={classNames(styles.controlButton, styles.controlButtonDanger)}
                  onPress={stopScenario}
                  aria-label="Stop scenario"
                >
                  <Stop className={styles.controlIcon} />
                  Stop
                </Button>
              )}
            </div>

            {/* ── Progress bar ── */}
            {isActive && (
              <div className={styles.progressSection}>
                <div className={styles.progressLabel}>
                  <span>
                    {formatSeconds(status.elapsed)} / {formatSeconds(duration)}
                  </span>
                  <span>
                    {status.eventsExecuted} / {status.scenario!.eventCount} events
                  </span>
                </div>
                <div className={styles.progressBar} role="progressbar" aria-valuenow={progress}>
                  <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* ── Upcoming events ── */}
            {isActive && status.upcomingEvents.length > 0 && (
              <>
                <PanelSectionLabel>Upcoming</PanelSectionLabel>
                <div className={styles.upcomingList}>
                  {status.upcomingEvents.slice(0, 5).map((ev, i) => (
                    <div key={i} className={styles.upcomingItem}>
                      <span className={styles.upcomingTime}>{formatSeconds(ev.at)}</span>
                      <span className={styles.upcomingType}>{ev.type}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Event log ── */}
            {eventLog.length > 0 && (
              <>
                <PanelSectionLabel>Event Log</PanelSectionLabel>
                <div className={styles.eventLog} data-testid="event-log">
                  {eventLog.map((entry, i) => (
                    <div key={i} className={styles.eventLogItem}>
                      <span className={styles.eventLogTime}>{formatSeconds(entry.time)}</span>
                      <span className={styles.eventLogType}>
                        {entry.type}
                        {entry.detail ? ` — ${entry.detail}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Available scenarios list ── */}
        <PanelSectionLabel>Available</PanelSectionLabel>
        {scenarios.length === 0 ? (
          <PanelEmptyState>No scenarios found</PanelEmptyState>
        ) : (
          <div className={styles.scenarioList}>
            {scenarios.map((file) => {
              const isLoading = loading === file.fileName;
              return (
                <Button
                  key={file.fileName}
                  className={classNames(styles.scenarioItem, {
                    [styles.scenarioItemActive]: isLoading,
                  })}
                  onPress={() => loadScenario(file.fileName)}
                  isDisabled={isLoading || isActive}
                  aria-label={`Load scenario ${file.fileName}`}
                >
                  <div className={styles.scenarioInfo}>
                    <div className={styles.scenarioName} title={file.fileName}>
                      {file.fileName.replace(/\.json$/, "")}
                    </div>
                    <div className={styles.scenarioMeta}>
                      <span>{formatFileSize(file.fileSize)}</span>
                      <span>{formatDate(file.modifiedAt)}</span>
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

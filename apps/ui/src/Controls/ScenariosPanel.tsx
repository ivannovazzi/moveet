import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import type { ScenarioFile, ScenarioStatus, ScenarioEventPayload } from "@/types";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelHeader,
  PanelSectionLabel,
} from "./PanelPrimitives";
import { Button } from "@/components/Inputs";
import { Play, Pause, Stop, ScenarioIcon } from "@/components/Icons";
import { LList, Tag, mono } from "@/Dock/DockPanelKit";

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

const controlIconClass = "size-3.5";

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

      <PanelBody className="gap-4">
        {/* ── Loaded scenario info + controls ── */}
        {hasScenario && (
          <>
            <div className="flex flex-col gap-2 rounded-md border border-accent/15 bg-accent/5 p-3">
              <div className="text-sm font-semibold text-foreground">{status.scenario!.name}</div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{status.scenario!.eventCount} events</span>
                <span>{formatSeconds(status.scenario!.duration)}</span>
                <span
                  className={cn(
                    "font-medium",
                    isRunning && "text-status-ok",
                    isPaused && "text-status-warn",
                    status.state === "idle" && "text-muted-foreground"
                  )}
                >
                  {status.state}
                </span>
              </div>
            </div>

            <div className="flex gap-2 py-1">
              {status.state === "idle" && (
                <Button variant="default" onClick={startScenario} aria-label="Start scenario">
                  <Play className={controlIconClass} />
                  Start
                </Button>
              )}
              {isRunning && (
                <Button onClick={pauseScenario} aria-label="Pause scenario">
                  <Pause className={controlIconClass} />
                  Pause
                </Button>
              )}
              {isPaused && (
                <Button variant="default" onClick={startScenario} aria-label="Resume scenario">
                  <Play className={controlIconClass} />
                  Resume
                </Button>
              )}
              {isActive && (
                <Button
                  className="text-status-error hover:text-status-error"
                  onClick={stopScenario}
                  aria-label="Stop scenario"
                >
                  <Stop className={controlIconClass} />
                  Stop
                </Button>
              )}
            </div>

            {/* ── Progress bar ── */}
            {isActive && (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
                  <span>
                    {formatSeconds(status.elapsed)} / {formatSeconds(duration)}
                  </span>
                  <span>
                    {status.eventsExecuted} / {status.scenario!.eventCount} events
                  </span>
                </div>
                <div
                  className="h-[5px] overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={progress}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-normal ease-standard"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* ── Upcoming events ── */}
            {isActive && status.upcomingEvents.length > 0 && (
              <>
                <PanelSectionLabel>Upcoming</PanelSectionLabel>
                <div className="flex flex-col gap-1">
                  {status.upcomingEvents.slice(0, 5).map((ev, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-sm px-2 py-1 text-xs text-muted-foreground"
                    >
                      <span className="min-w-10 font-mono tabular-nums text-muted-foreground">
                        {formatSeconds(ev.at)}
                      </span>
                      <span className="text-foreground">{ev.type}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Event log ── */}
            {eventLog.length > 0 && (
              <>
                <PanelSectionLabel>Event Log</PanelSectionLabel>
                <div
                  className="flex max-h-[200px] flex-col gap-1 overflow-y-auto"
                  data-testid="event-log"
                >
                  {eventLog.map((entry, i) => (
                    <div
                      key={i}
                      className="flex items-baseline gap-3 rounded-sm bg-muted/30 px-2 py-1 text-xs"
                    >
                      <span className="min-w-10 font-mono tabular-nums text-muted-foreground">
                        {formatSeconds(entry.time)}
                      </span>
                      <span className="text-muted-foreground">
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
          <PanelEmptyState icon={<ScenarioIcon />}>No scenarios found</PanelEmptyState>
        ) : (
          <LList>
            {scenarios.map((file) => {
              const isLoading = loading === file.fileName;
              return (
                <button
                  key={file.fileName}
                  type="button"
                  className={cn(
                    "grid w-full grid-cols-[3px_1fr_auto] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] text-left transition-colors duration-fast ease-standard first:border-t-0 hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-default disabled:opacity-60",
                    isLoading && "bg-accent/10"
                  )}
                  onClick={() => loadScenario(file.fileName)}
                  disabled={isLoading || isActive}
                  aria-label={`Load scenario ${file.fileName}`}
                >
                  <span
                    className={cn(
                      "h-[26px] w-[3px] rounded-[2px]",
                      isLoading ? "bg-accent" : "bg-border"
                    )}
                  />
                  <div className="min-w-0">
                    <div
                      className="truncate text-[12px] font-medium text-foreground"
                      title={file.fileName}
                    >
                      {file.fileName.replace(/\.json$/, "")}
                    </div>
                    <div
                      className={cn(
                        mono,
                        "mt-0.5 flex gap-2 truncate text-[10.5px] text-muted-foreground/70"
                      )}
                    >
                      <span>{formatFileSize(file.fileSize)}</span>
                      <span>{formatDate(file.modifiedAt)}</span>
                    </div>
                  </div>
                  {isLoading && <Tag tone="accent">Loading</Tag>}
                </button>
              );
            })}
          </LList>
        )}
      </PanelBody>
    </>
  );
}

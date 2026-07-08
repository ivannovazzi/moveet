import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingFile, ReplayStatus } from "@/types";
import {
  PanelBadge,
  PanelBody,
  PanelEmptyState,
  PanelHeader,
  PanelSectionLabel,
} from "./PanelPrimitives";
import { Button } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import client from "@/utils/client";
import { RecordCircleIcon } from "@/components/Icons";
import { LList, Tag, mono } from "@/Dock/DockPanelKit";
import {
  emitRecording,
  getEmitStatus,
  AdapterHttpError,
  type EmitStatus,
} from "./Adapter/adapterClient";

interface RecordReplayProps {
  recordings: RecordingFile[];
  replayStatus: ReplayStatus;
  onStartReplay: (file: string, speed?: number) => Promise<void>;
  /** Refresh the recordings list (e.g. after a generation completes). */
  onRefreshRecordings?: () => void | Promise<void>;
}

/** Recordings smaller than this are header-only (no events). */
const MIN_PLAYABLE_SIZE = 300;

/** How often to poll the adapter emit status. */
const EMIT_POLL_MS = 1000;

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
  const count = file.vehicleCount ?? parseVehicleCount(file.fileName);
  const date = formatDate(file.modifiedAt);
  return count ? `${count} vehicles — ${date}` : date;
}

/** Local-datetime-input value (YYYY-MM-DDТHH:mm) one week before now, in local time. */
function defaultStartLocal(): string {
  const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

interface GenerateProgress {
  jobId: string;
  step: number;
  totalSteps: number;
  pct: number;
}

const fieldLabelClass = "text-xs text-muted-foreground";
const fieldClass = "flex min-w-0 flex-1 flex-col gap-1";

export default function RecordReplay({
  recordings,
  replayStatus,
  onStartReplay,
  onRefreshRecordings,
}: RecordReplayProps) {
  const isReplayMode = replayStatus.mode === "replay";
  const isPaused = replayStatus.paused ?? false;
  // Server returns path like "recordings/file.ndjson", recordings list has just "file.ndjson"
  const activeFile = replayStatus.file?.replace(/^recordings\//, "") ?? null;

  const playableRecordings = recordings.filter((f) => f.fileSize >= MIN_PLAYABLE_SIZE);

  // ─── Generate historical form state ─────────────────────────────
  const [startLocal, setStartLocal] = useState(defaultStartLocal);
  const [hours, setHours] = useState(24);
  const [vehicleCount, setVehicleCount] = useState(20);
  const [stepSeconds, setStepSeconds] = useState(1);
  const [seed, setSeed] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const refreshRef = useRef(onRefreshRecordings);
  useEffect(() => {
    refreshRef.current = onRefreshRecordings;
  }, [onRefreshRecordings]);

  // ─── Sync generate status on mount (e.g. after a reload) ─────────
  useEffect(() => {
    let cancelled = false;
    client.getGenerateStatus().then((res) => {
      if (cancelled || !res.data) return;
      if (res.data.state === "running") {
        setGenerating(true);
        if (res.data.step != null && res.data.totalSteps != null) {
          setProgress({
            jobId: res.data.jobId ?? "",
            step: res.data.step,
            totalSteps: res.data.totalSteps,
            pct: res.data.pct ?? 0,
          });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Subscribe to generation WebSocket events ───────────────────
  useEffect(() => {
    const onProgress = (data: GenerateProgress) => {
      setGenerating(true);
      setProgress(data);
    };
    const onComplete = () => {
      setGenerating(false);
      setProgress(null);
      setGenerateError(null);
      void refreshRef.current?.();
    };
    const onError = (data: { error: string }) => {
      setGenerating(false);
      setProgress(null);
      setGenerateError(data.error);
    };

    client.onGenerateProgress(onProgress);
    client.onGenerateComplete(onComplete);
    client.onGenerateError(onError);
    return () => {
      client.offGenerateProgress(onProgress);
      client.offGenerateComplete(onComplete);
      client.offGenerateError(onError);
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerateError(null);
    const startTime = new Date(startLocal).toISOString();
    const seedNum = seed.trim() === "" ? undefined : Number(seed);
    const res = await client.generateRecording({
      startTime,
      hours,
      vehicleCount,
      stepMs: Math.max(1, Math.round(stepSeconds * 1000)),
      seed: seedNum != null && Number.isFinite(seedNum) ? seedNum : undefined,
    });
    if (res.error) {
      // 409 = a job is already running; reflect the running state.
      if (res.error.includes("409")) {
        setGenerating(true);
      } else {
        setGenerateError(res.error);
      }
      return;
    }
    setGenerating(true);
    setProgress(null);
  }, [startLocal, hours, vehicleCount, stepSeconds, seed]);

  const genPct = progress?.pct ?? 0;

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

      <PanelBody className="gap-4">
        {/* ── Generate historical ── */}
        <PanelSectionLabel>Generate historical</PanelSectionLabel>
        <div className="flex flex-col gap-3 rounded-md border border-border-soft bg-white/[0.03] p-3">
          <label className={fieldClass}>
            <span className={fieldLabelClass}>Start</span>
            <Input
              type="datetime-local"
              className="h-8 text-sm"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              disabled={generating}
              aria-label="Start date and time"
            />
          </label>
          <div className="flex gap-3">
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Hours</span>
              <Input
                type="number"
                min={1}
                className="h-8 text-sm"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                disabled={generating}
                aria-label="Duration in hours"
              />
            </label>
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Vehicles</span>
              <Input
                type="number"
                min={1}
                className="h-8 text-sm"
                value={vehicleCount}
                onChange={(e) => setVehicleCount(Number(e.target.value))}
                disabled={generating}
                aria-label="Vehicle count"
              />
            </label>
          </div>
          <div className="flex gap-3">
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Step (s)</span>
              <Input
                type="number"
                min={0.1}
                step={0.1}
                className="h-8 text-sm"
                value={stepSeconds}
                onChange={(e) => setStepSeconds(Number(e.target.value))}
                disabled={generating}
                aria-label="Step seconds"
              />
            </label>
            <label className={fieldClass}>
              <span className={fieldLabelClass}>Seed</span>
              <Input
                type="number"
                className="h-8 text-sm"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                disabled={generating}
                placeholder="random"
                aria-label="Seed (optional)"
              />
            </label>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerate}
            isDisabled={generating}
            aria-label="Generate historical recording"
          >
            {generating ? "Generating…" : "Generate"}
          </Button>

          {generating && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
                <span>
                  {progress ? `Step ${progress.step} / ${progress.totalSteps}` : "Starting…"}
                </span>
                <span>{Math.round(genPct)}%</span>
              </div>
              <div
                className="h-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(genPct)}
              >
                <div
                  className="h-full bg-accent transition-[width] duration-normal ease-standard"
                  style={{ width: `${genPct}%` }}
                />
              </div>
            </div>
          )}

          {generateError && <div className="text-xs text-status-error">{generateError}</div>}
        </div>

        {/* ── Saved recordings ── */}
        <div className="flex items-center">
          <PanelSectionLabel>Saved</PanelSectionLabel>
        </div>

        {playableRecordings.length === 0 ? (
          <PanelEmptyState icon={<RecordCircleIcon />}>No recordings yet</PanelEmptyState>
        ) : (
          <LList>
            {playableRecordings.map((file) => {
              const isActive = isReplayMode && activeFile === file.fileName;

              return (
                <div
                  key={file.fileName}
                  className={cn(
                    "flex flex-col gap-2 border-t border-border-soft px-2 py-[9px] first:border-t-0",
                    isActive && "bg-accent/[0.06]"
                  )}
                >
                  <button
                    type="button"
                    className="grid w-full grid-cols-[3px_1fr_auto] items-center gap-2.5 rounded-[2px] text-left transition-colors duration-fast ease-standard hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-default"
                    onClick={() => !isActive && onStartReplay(file.fileName, 1)}
                    disabled={isActive}
                    aria-label={`Play recording ${formatLabel(file)}`}
                  >
                    <span
                      className={cn(
                        "h-[26px] w-[3px] rounded-[2px]",
                        isActive ? "bg-accent" : "bg-border"
                      )}
                    />
                    <div className="min-w-0">
                      <div
                        className="truncate text-[12px] font-medium text-foreground"
                        title={file.fileName}
                      >
                        {formatLabel(file)}
                      </div>
                      <div
                        className={cn(
                          mono,
                          "mt-0.5 truncate text-[10.5px] text-muted-foreground/70"
                        )}
                      >
                        {formatFileSize(file.fileSize)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {file.generated && <Tag tone="accent">Gen</Tag>}
                      {isActive && (
                        <Tag tone={isPaused ? "warn" : "ok"}>{isPaused ? "Paused" : "Playing"}</Tag>
                      )}
                    </div>
                  </button>
                  <EmitControl recording={file} />
                </div>
              );
            })}
          </LList>
        )}
      </PanelBody>
    </>
  );
}

interface EmitControlProps {
  recording: RecordingFile;
}

/** Per-row "Emit to sinks" action with a realism toggle + polled progress. */
function EmitControl({ recording }: EmitControlProps) {
  const [realism, setRealism] = useState(true);
  const [emitting, setEmitting] = useState(false);
  const [status, setStatus] = useState<EmitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(async () => {
    try {
      const s = await getEmitStatus();
      setStatus(s);
      if (s.state === "done" || s.state === "error" || s.state === "idle") {
        setEmitting(false);
        stopPolling();
        if (s.state === "error" && s.error) setError(s.error);
      }
    } catch {
      // transient poll failure; keep polling
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => void poll(), EMIT_POLL_MS);
  }, [poll, stopPolling]);

  const handleEmit = useCallback(async () => {
    if (recording.id == null) {
      setError("Recording has no id; cannot emit");
      return;
    }
    setError(null);
    setStatus(null);
    try {
      await emitRecording({
        recordingId: recording.id,
        realism: realism ? "on" : "off",
      });
      setEmitting(true);
      void poll();
      startPolling();
    } catch (e) {
      if (e instanceof AdapterHttpError && e.status === 409) {
        // An emit is already running (possibly for another recording).
        setEmitting(true);
        void poll();
        startPolling();
      } else {
        setError(e instanceof Error ? e.message : "Emit failed");
      }
    }
  }, [recording.id, realism, poll, startPolling]);

  const pct = status?.pct ?? (status?.total ? (status.emitted / status.total) * 100 : 0);
  const canEmit = recording.id != null;

  return (
    <div className="flex w-full flex-col gap-2 border-t border-border/60 pt-2">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch
          isSelected={realism}
          onChange={setRealism}
          isDisabled={emitting}
          aria-label="Realism"
        />
        <span>Realism</span>
      </label>
      <Button
        variant="default"
        size="sm"
        onClick={handleEmit}
        isDisabled={emitting || !canEmit}
        aria-label={`Emit recording ${recording.fileName} to sinks`}
      >
        {emitting ? "Emitting…" : "Emit to sinks"}
      </Button>

      {emitting && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
            <span>
              {status?.total != null
                ? `${status.emitted} / ${status.total}`
                : `${status?.emitted ?? 0} emitted`}
            </span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
          >
            <div
              className="h-full bg-accent transition-[width] duration-normal ease-standard"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {status?.state === "done" && !emitting && (
        <div className="text-xs text-muted-foreground">Emitted {status.emitted} fixes</div>
      )}
      {error && <div className="text-xs text-status-error">{error}</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button, SquaredButton } from "@/components/Inputs";
import { Input } from "@/components/ui/input";
import { Eyebrow, LList, LRow, Tag, mono, type SevTone } from "@/Dock/DockPanelKit";
import { PanelEmptyState, PanelErrorState } from "./PanelPrimitives";
import { JobIcon } from "@/components/Icons";
import type { JobAssignmentStrategy, JobDTO, JobStatus } from "@/types";
import type { JobDraft } from "@/hooks/useJobDraft";
import type { JobCounts } from "@/hooks/useJobs";
import { isJobLive } from "@/hooks/useJobs";

/** Operator-facing status wording. The wire values are snake_case internals. */
const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Queued",
  assigned: "Assigned",
  en_route: "To pickup",
  on_scene: "On scene",
  transporting: "Carrying",
  complete: "Complete",
  cancelled: "Cancelled",
  failed: "Failed",
};

/**
 * Status → row tone. Deliberately three-tier rather than one colour per status:
 * the operator's question is "is this job fine, does it need watching, or is it
 * broken", and eight hues answer a question nobody asked.
 */
const STATUS_TONE: Record<JobStatus, SevTone> = {
  pending: "idle",
  assigned: "accent",
  en_route: "accent",
  on_scene: "warn",
  transporting: "accent",
  complete: "ok",
  cancelled: "idle",
  failed: "error",
};

const STRATEGIES: { value: JobAssignmentStrategy; label: string; hint: string }[] = [
  { value: "nearest", label: "Nearest", hint: "Closest free vehicle by distance" },
  { value: "best_eta", label: "Best ETA", hint: "Lowest driving time — pathfinds candidates" },
];

/** `mm:ss`, or `+mm:ss` once the deadline has passed. */
function formatCountdown(deadline: number, now: number): string {
  const deltaMs = deadline - now;
  const late = deltaMs < 0;
  const totalSeconds = Math.floor(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${late ? "+" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatEta(seconds?: number): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function formatCoord([lat, lng]: [number, number]): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** One-line "what this job is doing right now" summary under the reference. */
function jobSecondary(job: JobDTO): string {
  if (job.status === "pending") {
    return job.error ?? "Queued — waiting for a vehicle";
  }
  if (job.status === "failed") return job.error ?? "Assignment failed";

  const unit = job.vehicleName ?? "unassigned";
  if (job.status === "en_route") {
    const eta = formatEta(job.etaToPickupSeconds);
    return eta ? `${unit} · pickup in ${eta}` : unit;
  }
  if (job.status === "transporting") {
    const eta = formatEta(job.etaToDropoffSeconds);
    return eta ? `${unit} · dropoff in ${eta}` : unit;
  }
  if (job.status === "complete") {
    return `${unit} · ${formatCoord(job.dropoff.position)}`;
  }
  return unit;
}

export interface JobsPanelProps {
  jobs: JobDTO[];
  counts: JobCounts;
  draft: JobDraft;
  onCancelJob: (id: string) => Promise<void>;
  onDeleteJob: (id: string) => Promise<void>;
  error?: string | null;
}

/**
 * The job board: create a pickup/dropoff job by clicking the map twice, then
 * watch each job move through its lifecycle with a live SLA countdown.
 *
 * Rendered as the Fleet panel's "Jobs" tab — jobs are dispatch work, and putting
 * them beside the vehicle list keeps "who is free" and "what needs doing" in one
 * place.
 */
export default function JobsPanel({
  jobs,
  counts,
  draft,
  onCancelJob,
  onDeleteJob,
  error,
}: JobsPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  // One shared 1 Hz tick drives every countdown; no timer per row.
  useEffect(() => {
    if (counts.live === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [counts.live]);

  // Newest first: the job just created is the one being watched.
  const ordered = [...jobs].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-[15px] pb-3 pt-1">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Assignment</Eyebrow>
          <div className="flex gap-0.5" role="group" aria-label="Assignment strategy">
            {STRATEGIES.map((option) => {
              const selected = draft.strategy === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  title={option.hint}
                  onClick={() => draft.setStrategy(option.value)}
                  className={cn(
                    "rounded-md px-2 py-[3px] text-[10.5px] font-medium",
                    "transition-[color,background-color] duration-fast ease-standard",
                    selected
                      ? "bg-foreground/[0.06] text-foreground shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
                      : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2 text-[10.5px] text-muted-foreground">
            <span className="whitespace-nowrap">SLA (min)</span>
            <Input
              type="number"
              min={1}
              max={1440}
              value={draft.slaMinutes}
              aria-label="SLA budget in minutes"
              onChange={(e) => {
                // An empty field is mid-edit, not "zero minutes" — keep the last
                // committed value rather than pushing 0 into the draft.
                if (e.target.value === "") return;
                const parsed = Number(e.target.value);
                if (Number.isFinite(parsed)) draft.setSlaMinutes(parsed);
              }}
              className={cn(mono, "h-7 w-16 text-[11px]")}
            />
          </label>
          {draft.active ? (
            <Button variant="outline" size="sm" onClick={draft.cancel}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={draft.start}
              isDisabled={draft.submitting}
              aria-label="New job"
            >
              {draft.submitting ? "Creating…" : "New job"}
            </Button>
          )}
        </div>

        {draft.active && (
          <p
            className="rounded-md border border-accent/35 bg-accent/[0.07] px-2.5 py-1.5 text-[11px] text-foreground"
            role="status"
          >
            {draft.stage === "pickup"
              ? "Click the map to set the pickup."
              : "Click the map to set the dropoff. Esc cancels."}
          </p>
        )}
      </div>

      {error ? (
        <div className="px-[15px] pb-2">
          <PanelErrorState>{error}</PanelErrorState>
        </div>
      ) : null}

      {ordered.length === 0 && !error ? (
        <div className="px-[15px] pb-3">
          <PanelEmptyState icon={<JobIcon />}>
            No jobs yet — create one to see the dispatch lifecycle
          </PanelEmptyState>
        </div>
      ) : null}

      <LList className="px-2 pb-2.5 pt-0">
        {ordered.map((job) => {
          const live = isJobLive(job);
          const tone: SevTone = job.slaBreached && live ? "error" : STATUS_TONE[job.status];
          return (
            <LRow
              key={job.id}
              tone={tone}
              primary={
                <span className="flex items-center gap-1.5">
                  <span className={mono}>{job.reference}</span>
                  {job.slaBreached && <Tag tone="error">Late</Tag>}
                </span>
              }
              secondary={jobSecondary(job)}
              meta={
                <>
                  <Tag tone={tone}>{STATUS_LABEL[job.status]}</Tag>
                  {live && (
                    <span
                      className={cn(
                        mono,
                        "whitespace-nowrap text-[11px]",
                        job.slaBreached ? "text-status-error" : "text-muted-foreground"
                      )}
                      title="Time remaining against the SLA deadline"
                    >
                      {formatCountdown(job.slaDeadline, now)}
                    </span>
                  )}
                  {live ? (
                    <SquaredButton
                      className="flex-shrink-0"
                      icon={<span aria-hidden="true">×</span>}
                      variant="ghost"
                      tone="danger"
                      aria-label={`Cancel job ${job.reference}`}
                      title="Cancel job"
                      onClick={() => onCancelJob(job.id)}
                    />
                  ) : (
                    <SquaredButton
                      className="flex-shrink-0"
                      icon={<span aria-hidden="true">×</span>}
                      variant="ghost"
                      aria-label={`Remove job ${job.reference}`}
                      title="Remove from board"
                      onClick={() => onDeleteJob(job.id)}
                    />
                  )}
                </>
              }
            />
          );
        })}
      </LList>
    </div>
  );
}

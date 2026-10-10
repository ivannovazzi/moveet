import { Button } from "@/components/Inputs";
import { Tag, mono, type SevTone } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import { formatBytes } from "./bbox";
import { isJobActive } from "./mapsStore";
import type { MapJob } from "./mapsClient";

/** Finished builds kept on screen under the running ones. */
const RECENT_FINISHED = 3;

const STEP_LABEL: Record<string, string> = {
  queued: "Waiting in queue",
  download: "Downloading extract",
  extract: "Cutting out the area",
  filter: "Filtering roads",
  export: "Exporting the road network",
  prune: "Pruning disconnected roads",
  validate: "Validating",
  buildings: "Building 3D footprints",
  finalize: "Finishing",
  activate: "Switching to the new map",
};

const STATUS_TONE: Record<MapJob["status"], SevTone> = {
  queued: "idle",
  running: "accent",
  done: "ok",
  failed: "error",
  cancelled: "idle",
};

export function stepLabel(step: string): string {
  return STEP_LABEL[step] ?? step.charAt(0).toUpperCase() + step.slice(1);
}

function jobTitle(job: MapJob): string {
  return job.label || job.mapId || "New map";
}

/** The jobs worth showing: every running one, then the latest few that finished. */
export function visibleJobs(jobs: MapJob[]): MapJob[] {
  const active = jobs.filter(isJobActive);
  const finished = jobs.filter((j) => !isJobActive(j)).slice(0, RECENT_FINISHED);
  return [...active, ...finished];
}

/**
 * Map builds: step, progress bar, bytes downloaded and a way to cancel. Reads
 * the store's job list, which outlives the panel, so a build started here and
 * left running is still listed when the panel is opened again (or the page
 * reloaded: the list is reloaded from `/maps/jobs`).
 */
export function MapJobs({
  jobs,
  onCancel,
  canCancel,
}: {
  jobs: MapJob[];
  onCancel: (id: string) => void;
  /** False while builds are disabled on the server (cancel answers 403 then). */
  canCancel: boolean;
}) {
  const shown = visibleJobs(jobs);
  if (shown.length === 0) return null;
  const running = shown.find((j) => j.status === "running") ?? shown.find(isJobActive);

  return (
    <section aria-label="Map builds" className="flex flex-col">
      {/* Announces step changes, not every percent: a screen reader reading
          "41%, 42%, 43%" is noise, "Building Lisbon: filtering roads" is news. */}
      <div role="status" aria-live="polite" className="sr-only">
        {running ? `Building ${jobTitle(running)}: ${stepLabel(running.step)}` : ""}
      </div>
      <ul className="flex flex-col px-2 pb-2">
        {shown.map((job) => {
          const active = isJobActive(job);
          const pct = Math.round(job.progress * 100);
          return (
            <li
              key={job.id}
              className="flex flex-col gap-1.5 border-t border-border-soft px-2 py-[9px] first:border-t-0"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">
                  {jobTitle(job)}
                </span>
                <Tag tone={STATUS_TONE[job.status]}>{job.status}</Tag>
                {/* Cancelling during the activate step would not stop the switch. */}
                {active && job.step !== "activate" && (
                  <Button
                    size="xs"
                    onClick={() => onCancel(job.id)}
                    disabled={!canCancel}
                    aria-label={`Cancel building ${jobTitle(job)}`}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              {active && (
                <>
                  <div className="flex justify-between gap-2 text-micro text-muted-foreground">
                    <span className="truncate">{stepLabel(job.step)}</span>
                    <span className={cn(mono, "shrink-0")}>
                      {job.bytesDownloaded != null && job.step === "download"
                        ? job.totalBytes
                          ? `${formatBytes(job.bytesDownloaded)} of ${formatBytes(job.totalBytes)}`
                          : formatBytes(job.bytesDownloaded)
                        : `${pct}%`}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${jobTitle(job)} build progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    aria-valuetext={`${pct}%, ${stepLabel(job.step)}`}
                    className="h-[5px] overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-normal ease-standard"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </>
              )}
              {job.error && (
                <p
                  className={cn(
                    "text-micro leading-snug",
                    job.status === "failed" ? "text-status-error" : "text-status-warn"
                  )}
                >
                  {job.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

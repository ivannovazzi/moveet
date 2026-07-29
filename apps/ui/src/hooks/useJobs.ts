import { useCallback, useEffect, useMemo, useState } from "react";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import type { CreateJobRequest, JobAssignmentStrategy, JobDTO, JobStatus } from "@/types";

/** Statuses that no longer move on their own. Mirrors the simulator's set. */
const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["complete", "cancelled", "failed"]);

export function isJobLive(job: JobDTO): boolean {
  return !TERMINAL.has(job.status);
}

/** Counts the job board summarises in the panel header. */
export interface JobCounts {
  total: number;
  live: number;
  queued: number;
  breached: number;
}

export interface UseJobs {
  jobs: JobDTO[];
  /** Live jobs only — what the map draws and the header counts. */
  liveJobs: JobDTO[];
  counts: JobCounts;
  createJob: (request: CreateJobRequest) => Promise<JobDTO | null>;
  assignJob: (
    id: string,
    body: { vehicleId?: string; strategy?: JobAssignmentStrategy }
  ) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  error: string | null;
}

/**
 * The job board: a REST snapshot on mount, then kept current by the four
 * `job:*` WS channels.
 *
 * `job:created` and `job:updated` are both upserts (the simulator emits
 * `created` once, then an `updated` per transition), so a missed frame
 * self-heals on the next transition rather than leaving a hole. A simulation
 * reset clears the board simulator-side, so the `reset` frame refetches instead
 * of trying to reconcile.
 */
export function useJobs(): UseJobs {
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      client
        .getJobs()
        .then((res) => {
          if (cancelled) return;
          if (res.error) {
            setError(res.error);
            console.warn("useJobs: failed to fetch jobs", res.error);
            return;
          }
          if (res.data) setJobs(res.data);
        })
        .catch((e) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : "Unknown error";
          setError(msg);
          console.warn("useJobs: failed to fetch jobs", msg);
        });
    };

    load();

    const upsert = (job: JobDTO) => {
      setJobs((prev) => {
        const index = prev.findIndex((j) => j.id === job.id);
        if (index === -1) return [...prev, job];
        const next = prev.slice();
        next[index] = job;
        return next;
      });
    };

    const removed = ({ id }: { id: string }) => {
      setJobs((prev) => prev.filter((j) => j.id !== id));
    };

    const breached = (job: JobDTO) => {
      upsert(job);
      toast.error(`${job.reference} breached its SLA`);
    };

    client.onJobCreated(upsert);
    client.onJobUpdated(upsert);
    client.onJobSlaBreach(breached);
    client.onJobDeleted(removed);
    client.onReset(load);

    return () => {
      cancelled = true;
      client.offJobCreated(upsert);
      client.offJobUpdated(upsert);
      client.offJobSlaBreach(breached);
      client.offJobDeleted(removed);
      client.offReset(load);
    };
  }, []);

  const liveJobs = useMemo(() => jobs.filter(isJobLive), [jobs]);

  const counts = useMemo<JobCounts>(
    () => ({
      total: jobs.length,
      live: liveJobs.length,
      queued: jobs.filter((j) => j.status === "pending").length,
      breached: jobs.filter((j) => j.slaBreached && isJobLive(j)).length,
    }),
    [jobs, liveJobs]
  );

  const createJob = useCallback(async (request: CreateJobRequest): Promise<JobDTO | null> => {
    setError(null);
    const res = await client.createJob(request);
    if (res.error || !res.data) {
      const message = res.error ?? "Failed to create job";
      setError(message);
      toast.error(message);
      return null;
    }
    const job = res.data;
    if (job.vehicleName) {
      toast.success(`${job.reference} assigned to ${job.vehicleName}`);
    } else {
      toast.info(`${job.reference} queued — waiting for a free vehicle`);
    }
    return job;
  }, []);

  const assignJob = useCallback(
    async (id: string, body: { vehicleId?: string; strategy?: JobAssignmentStrategy }) => {
      setError(null);
      const res = await client.assignJob(id, body);
      if (res.error) {
        setError(res.error);
        toast.error(res.error);
      }
    },
    []
  );

  const cancelJob = useCallback(async (id: string) => {
    setError(null);
    const res = await client.cancelJob(id);
    if (res.error) {
      setError(res.error);
      toast.error(res.error);
    }
  }, []);

  const deleteJob = useCallback(async (id: string) => {
    setError(null);
    const res = await client.deleteJob(id);
    if (res.error) {
      setError(res.error);
      toast.error(res.error);
    }
  }, []);

  return { jobs, liveJobs, counts, createJob, assignJob, cancelJob, deleteJob, error };
}

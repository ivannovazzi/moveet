import { useCallback, useRef, useState } from "react";
import type { CreateJobRequest, JobAssignmentStrategy, JobDTO, Position } from "@/types";

/**
 * Which click the operator owes us next.
 *  - `idle`: not placing a job.
 *  - `pickup`: the next map click sets the pickup.
 *  - `dropoff`: pickup is down; the next click sets the dropoff and submits.
 */
export type JobDraftStage = "idle" | "pickup" | "dropoff";

const DEFAULT_SLA_MINUTES = 15;

export interface JobDraft {
  stage: JobDraftStage;
  /** True while a job is being placed — the map is in a modal picking mode. */
  active: boolean;
  pickup: Position | null;
  strategy: JobAssignmentStrategy;
  slaMinutes: number;
  submitting: boolean;
  setStrategy: (strategy: JobAssignmentStrategy) => void;
  setSlaMinutes: (minutes: number) => void;
  /** Enters placement mode at the pickup step. */
  start: () => void;
  /** Leaves placement mode, discarding a half-placed job. */
  cancel: () => void;
  /**
   * Feeds a map click into the draft. Returns true when the click was consumed,
   * so the caller knows not to also treat it as a selection/waypoint click.
   */
  handleMapClick: (position: Position) => boolean;
}

/**
 * Two-click job placement: first click is the pickup, second is the dropoff,
 * and the second click submits.
 *
 * Kept separate from `useDispatchFlow` on purpose — dispatch sends a *vehicle*
 * somewhere and needs a vehicle selected first, whereas a job is created against
 * the map and the simulator chooses the vehicle. Sharing one state machine would
 * mean one of the two lying about what the next click means.
 */
export function useJobDraft(
  createJob: (request: CreateJobRequest) => Promise<JobDTO | null>
): JobDraft {
  const [stage, setStage] = useState<JobDraftStage>("idle");
  const [pickup, setPickup] = useState<Position | null>(null);
  const [strategy, setStrategy] = useState<JobAssignmentStrategy>("nearest");
  const [slaMinutes, setSlaMinutes] = useState(DEFAULT_SLA_MINUTES);
  const [submitting, setSubmitting] = useState(false);

  // Read inside handleMapClick so the callback stays stable across renders —
  // it is wired into the map click path, which must not rebuild every keystroke
  // in the SLA field.
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const pickupRef = useRef(pickup);
  pickupRef.current = pickup;
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const slaRef = useRef(slaMinutes);
  slaRef.current = slaMinutes;
  const createRef = useRef(createJob);
  createRef.current = createJob;

  const start = useCallback(() => {
    setPickup(null);
    setStage("pickup");
  }, []);

  const cancel = useCallback(() => {
    setPickup(null);
    setStage("idle");
  }, []);

  const handleMapClick = useCallback((position: Position): boolean => {
    if (stageRef.current === "idle") return false;

    if (stageRef.current === "pickup") {
      setPickup(position);
      setStage("dropoff");
      return true;
    }

    const from = pickupRef.current;
    if (!from) {
      // Defensive: a dropoff stage with no pickup can only mean state was reset
      // mid-placement. Restart rather than submit half a job.
      setStage("pickup");
      return true;
    }

    setSubmitting(true);
    setStage("idle");
    setPickup(null);
    void createRef
      .current({
        pickup: { lat: from[0], lng: from[1] },
        dropoff: { lat: position[0], lng: position[1] },
        strategy: strategyRef.current,
        slaSeconds: Math.max(1, Math.round(slaRef.current * 60)),
      })
      .finally(() => setSubmitting(false));

    return true;
  }, []);

  return {
    stage,
    active: stage !== "idle",
    pickup,
    strategy,
    slaMinutes,
    submitting,
    setStrategy,
    setSlaMinutes,
    start,
    cancel,
    handleMapClick,
  };
}

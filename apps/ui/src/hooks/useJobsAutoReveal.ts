import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Modifiers } from "@/types";

/**
 * Reveals the job overlay the first time the board goes from empty to non-empty.
 *
 * Edge-triggered, exactly like `useHeatzoneAutoReveal`: a freshly-created job
 * should be visible on the map without the operator hunting for a toggle, but
 * once revealed the toggle is theirs again — a level-triggered effect would
 * flip `showJobs` back on every render and make the control look broken.
 */
export function useJobsAutoReveal(
  jobCount: number,
  setModifiers: Dispatch<SetStateAction<Modifiers>>
): void {
  const reveal = () => setModifiers((prev) => (prev.showJobs ? prev : { ...prev, showJobs: true }));
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  const prevCount = useRef(jobCount);
  useEffect(() => {
    const wasEmpty = prevCount.current === 0;
    prevCount.current = jobCount;
    if (wasEmpty && jobCount > 0) revealRef.current();
  }, [jobCount]);
}

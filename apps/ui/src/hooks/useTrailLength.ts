import { useCallback, useEffect, useRef, useState } from "react";
import { vehicleStore } from "@/hooks/vehicleStore";

const MIN = 10;
const MAX = 120;
const DEFAULT = 60;
const STORAGE_KEY = "trailLength";
/** Long enough that a drag doesn't trim trails on every step. */
const COMMIT_DELAY_MS = 200;

export const TRAIL_LENGTH_RANGE = { min: MIN, max: MAX, step: 10 } as const;

function readStored(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN && n <= MAX) return n;
    }
  } catch {
    // ignore localStorage errors
  }
  return DEFAULT;
}

export interface TrailLength {
  /** What the slider shows — updates on every step. */
  value: number;
  /** Moves the slider now, commits to the store/localStorage after a beat. */
  set: (value: number) => void;
}

/**
 * The breadcrumb trail capacity: slider value in React, the actual capacity in
 * `vehicleStore`.
 *
 * `setTrailCapacity` trims every vehicle's trail synchronously, so applying it
 * on each slider step while dragging can block the frame. The commit (and the
 * localStorage write) is debounced and flushed on unmount, so a change made and
 * then immediately closed is never dropped.
 */
export function useTrailLength(): TrailLength {
  const [value, setValue] = useState(() => {
    const initial = readStored();
    vehicleStore.setTrailCapacity(initial);
    return initial;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<number | null>(null);

  const commit = useCallback((next: number) => {
    pendingRef.current = null;
    vehicleStore.setTrailCapacity(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      if (pendingRef.current !== null) commit(pendingRef.current);
    };
  }, [commit]);

  const set = useCallback(
    (next: number) => {
      setValue(next);
      pendingRef.current = next;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => commit(next), COMMIT_DELAY_MS);
    },
    [commit]
  );

  return { value, set };
}

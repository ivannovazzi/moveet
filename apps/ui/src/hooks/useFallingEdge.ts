import { useEffect, useRef } from "react";

/**
 * Runs `onFall` on the active → inactive transition (the falling edge) of
 * `active`. Nothing fires on the rising edge or on the initial mount.
 *
 * Extracted from the identical edge-detect-then-cleanup pattern that lived in
 * useDispatchFlow (`wasActiveRef`) and useGeofenceManager (`wasDrawingRef`):
 * a mode can be exited from outside the owning hook (entering another mode, a
 * replay starting, …), so each mode clears its own leftover state on the edge.
 * `onFall` is read through a ref so it can change identity without
 * resubscribing / re-firing.
 */
export function useFallingEdge(active: boolean, onFall: () => void): void {
  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;
  const prevRef = useRef(active);

  useEffect(() => {
    if (prevRef.current && !active) onFallRef.current();
    prevRef.current = active;
  }, [active]);
}

import { useMapControls } from "@/components/Map/hooks";
import type { Vehicle } from "@/types";
import { useEffect, useRef } from "react";

/**
 * Minimum zoom the camera flies to when a vehicle is selected from a far
 * overview. When already zoomed in past this, the user's zoom is kept.
 */
export const MIN_FOCUS_ZOOM = 14;

/**
 * How long the fly to a selected vehicle takes. A fixed, human-scaled duration:
 * it used to be the simulator's tick interval, which is a data-rate setting, so
 * the fly snapped (0 before status loaded, a few hundred ms at fast ticks).
 */
export const FOCUS_FLY_MS = 800;

/**
 * Fly to the selected vehicle ONCE per selection, at the user's current zoom
 * floored to MIN_FOCUS_ZOOM. Position ticks never re-center the viewport, so
 * the user can pan/zoom freely while a vehicle stays selected. The camera
 * moves again only when the selection changes (or the vehicle is re-selected
 * after being deselected).
 */
export default function useTracking(vehicles: Vehicle[], selected: string | undefined) {
  const { focusOn, getZoom } = useMapControls();
  const vehicle = vehicles.find((v) => v.id === selected);
  const [lng, lat] = vehicle?.position || [null, null];
  const hasPosition = lng != null && lat != null;

  // Latest position, read when the fly fires. Kept out of the effect deps so a
  // position tick landing inside the two-frame settle wait does not cancel the
  // pending fly (the guard below would then refuse to schedule it again).
  const positionRef = useRef<[number | null, number | null]>([lng, lat]);
  positionRef.current = [lng, lat];

  // Selection id we already flew to — guards against per-tick re-centering
  // (lng/lat update ~every second and must not fight the user's viewport).
  const flownToRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!selected) {
      flownToRef.current = undefined;
      return;
    }
    if (flownToRef.current === selected) return;
    if (!hasPosition) return;
    flownToRef.current = selected;
    // Selecting a vehicle also opens the inspector, which pushes the dock
    // panel left, which moves the band of map the camera should aim into
    // (see mapInsets). Those surfaces settle over the next two frames, so the
    // fly waits for them rather than aiming at where the chrome used to be.
    let frame = 0;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const [x, y] = positionRef.current;
        if (x == null || y == null) return;
        focusOn(x, y, Math.max(getZoom(), MIN_FOCUS_ZOOM), { duration: FOCUS_FLY_MS });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, hasPosition, focusOn, getZoom]);
}

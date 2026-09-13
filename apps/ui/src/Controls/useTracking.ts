import { useMapControls } from "@/components/Map/hooks";
import type { Vehicle } from "@/types";
import { useEffect, useRef } from "react";

/**
 * Minimum zoom the camera flies to when a vehicle is selected from a far
 * overview. When already zoomed in past this, the user's zoom is kept.
 */
export const MIN_FOCUS_ZOOM = 14;

/**
 * Fly to the selected vehicle ONCE per selection, at the user's current zoom
 * floored to MIN_FOCUS_ZOOM. Position ticks never re-center the viewport, so
 * the user can pan/zoom freely while a vehicle stays selected. The camera
 * moves again only when the selection changes (or the vehicle is re-selected
 * after being deselected).
 */
export default function useTracking(
  vehicles: Vehicle[],
  selected: string | undefined,
  duration: number = 0
) {
  const { focusOn, getZoom } = useMapControls();
  const vehicle = vehicles.find((v) => v.id === selected);
  const [lng, lat] = vehicle?.position || [null, null];

  // Selection id we already flew to — guards against per-tick re-centering
  // (lng/lat update ~every second and must not fight the user's viewport).
  const flownToRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!selected) {
      flownToRef.current = undefined;
      return;
    }
    if (flownToRef.current === selected) return;
    if (lng == null || lat == null) return;
    flownToRef.current = selected;
    // Selecting a vehicle also opens the inspector, which pushes the dock
    // panel left, which moves the band of map the camera should aim into
    // (see mapInsets). Those surfaces settle over the next two frames, so the
    // fly waits for them rather than aiming at where the chrome used to be.
    const zoom = Math.max(getZoom(), MIN_FOCUS_ZOOM);
    let frame = 0;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => focusOn(lng, lat, zoom, { duration }));
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, lng, lat, duration, focusOn, getZoom]);
}

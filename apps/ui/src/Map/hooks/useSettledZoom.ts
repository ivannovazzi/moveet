import { useState, useEffect, useRef } from "react";

/** Delay after zooming stops before updating the settled value. */
const SETTLE_DELAY_MS = 300;

/** Quantization step — prevents churn during smooth zoom animations. */
const ZOOM_STEP = 0.5;

export interface SettledZoom {
  settledZoom: number;
  /** True while the user is actively zooming (viewport still changing). */
  isZooming: boolean;
}

/**
 * Returns a debounced, quantized zoom that only updates after the user
 * stops zooming for {@link SETTLE_DELAY_MS}, plus a flag indicating
 * whether a zoom gesture is in progress.
 *
 * Layers can use `isZooming` to hide items during the gesture and then
 * let deck.gl enter-transitions fade them in once zooming stops.
 */
export function useSettledZoom(zoom: number): SettledZoom {
  const [settled, setSettled] = useState(() => Math.floor(zoom / ZOOM_STEP) * ZOOM_STEP);
  const [isZooming, setIsZooming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevZoomRef = useRef(zoom);

  useEffect(() => {
    // Skip the initial mount — zoom hasn't actually changed.
    if (prevZoomRef.current === zoom) return;
    prevZoomRef.current = zoom;

    setIsZooming(true);
    clearTimeout(timerRef.current);
    const quantized = Math.floor(zoom / ZOOM_STEP) * ZOOM_STEP;
    timerRef.current = setTimeout(() => {
      setSettled(quantized);
      setIsZooming(false);
    }, SETTLE_DELAY_MS);
    return () => clearTimeout(timerRef.current);
  }, [zoom]);

  return { settledZoom: settled, isZooming };
}

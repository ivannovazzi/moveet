import { useEffect, useRef } from "react";
import { useViewportBbox } from "@/hooks/useViewportBbox";
import type { BoundingBox } from "@moveet/shared-types";

interface Props {
  onBboxChange: (bbox: BoundingBox | null) => void;
}

/**
 * Headless component rendered inside the MapContext tree. It reads the
 * debounced viewport bbox and reports changes up via callback.
 */
export function ViewportBboxReporter({ onBboxChange }: Props) {
  const bbox = useViewportBbox();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    const key = bbox ? `${bbox.minLat},${bbox.maxLat},${bbox.minLng},${bbox.maxLng}` : null;
    if (key === prevRef.current) return;
    prevRef.current = key;
    onBboxChange(bbox);
  }, [bbox, onBboxChange]);

  return null;
}

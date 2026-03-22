import { useEffect, useRef, useMemo } from "react";
import { useMapContext } from "@/components/Map/hooks";
import type { BoundingBox } from "@moveet/shared-types";

interface Props {
  onBboxChange: (bbox: BoundingBox | null) => void;
}

/** Minimum zoom level before we emit a bbox filter. At low zoom the
 *  viewport covers the entire map so filtering by bbox is pointless. */
const MIN_ZOOM = 3;

/**
 * Headless component rendered inside the DeckGLMap tree. It reads the
 * viewport bounding box from the deck.gl context and reports changes
 * up via callback.
 */
export function ViewportBboxReporter({ onBboxChange }: Props) {
  const { viewport, getZoom, getBoundingBox } = useMapContext();
  const prevRef = useRef<string | null>(null);

  const bbox = useMemo<BoundingBox | null>(() => {
    if (!viewport) return null;
    const zoom = getZoom();
    if (zoom < MIN_ZOOM) return null;

    const [[lng1, lat1], [lng2, lat2]] = getBoundingBox();
    return {
      minLat: Math.min(lat1, lat2),
      maxLat: Math.max(lat1, lat2),
      minLng: Math.min(lng1, lng2),
      maxLng: Math.max(lng1, lng2),
    };
  }, [viewport, getZoom, getBoundingBox]);

  useEffect(() => {
    const key = bbox ? `${bbox.minLat},${bbox.maxLat},${bbox.minLng},${bbox.maxLng}` : null;
    if (key === prevRef.current) return;
    prevRef.current = key;
    onBboxChange(bbox);
  }, [bbox, onBboxChange]);

  return null;
}

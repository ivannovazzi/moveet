import { useEffect, useRef, useState } from "react";
import { useMapContext } from "@/components/Map/hooks";
import type { BoundingBox } from "@moveet/shared-types";

/** Minimum zoom level before we emit a bbox filter. At low zoom the
 *  viewport covers the entire map so filtering by bbox is pointless. */
const MIN_ZOOM = 3;

/** Debounce interval (ms) for coalescing rapid pan/zoom updates. */
const DEBOUNCE_MS = 300;

/**
 * Reads the current map viewport from MapContext and returns a debounced
 * BoundingBox suitable for the subscribe filter. Returns `null` when zoom
 * is too low (meaning "show all vehicles").
 *
 * Must be rendered inside the MapContext tree (i.e. as a child of
 * RoadNetworkMap).
 */
export function useViewportBbox(): BoundingBox | null {
  const { transform, getBoundingBox } = useMapContext();
  const [bbox, setBbox] = useState<BoundingBox | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const zoom = transform?.k ?? 0;
      if (zoom < MIN_ZOOM) {
        setBbox(null);
        return;
      }

      const [[lng1, lat1], [lng2, lat2]] = getBoundingBox();
      setBbox({
        minLat: Math.min(lat1, lat2),
        maxLat: Math.max(lat1, lat2),
        minLng: Math.min(lng1, lng2),
        maxLng: Math.max(lng1, lng2),
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [transform, getBoundingBox]);

  return bbox;
}

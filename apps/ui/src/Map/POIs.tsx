import { useMemo, useState, useEffect, useRef } from "react";
import type { WebMercatorViewport } from "@deck.gl/core";
import { useMapContext } from "@/components/Map/hooks";
import { usePois } from "@/hooks/usePois";
import POIMarker from "./POI/POI";
import type { POI } from "@/types";
import { isBusStop, isNotBusStop } from "./POI/helpers";

/** Minimum distance in pixels between regular POI markers to avoid overlap */
const POI_MIN_DISTANCE_PX = 80;

/** Minimum distance in pixels between bus stop markers to avoid overlap */
const BUS_STOP_MIN_DISTANCE_PX = 15;

/** Debounce delay to avoid recomputing during rapid zoom/pan */
const DEBOUNCE_MS = 150;

/** Returns the squared Euclidean distance in pixels between two points. */
function distanceSq(x1: number, y1: number, x2: number, y2: number) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function getBySpacing(items: POI[], viewport: WebMercatorViewport, minPxDistance: number) {
  const placed: Array<{ poi: POI; px: number; py: number }> = [];
  const minDistSq = minPxDistance * minPxDistance;

  for (const poi of items) {
    const [lat, lng] = poi.coordinates;
    const [px, py] = viewport.project([lng, lat]);

    if (!isFinite(px) || !isFinite(py)) continue;

    let tooClose = false;
    for (let i = 0; i < placed.length; i++) {
      if (distanceSq(px, py, placed[i].px, placed[i].py) < minDistSq) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      placed.push({ poi, px, py });
    }
  }
  return placed;
}

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { viewport, getBoundingBox } = useMapContext();

  // Debounced viewport — only update after zoom/pan settles
  const [stableViewport, setStableViewport] = useState(viewport);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStableViewport(viewport), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [viewport]);

  const [[west, south], [east, north]] = getBoundingBox();

  const inBoundsPois = useMemo(() => {
    if (!stableViewport) return [];

    return pois
      .filter((poi) => !!poi.name)
      .filter(
        ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
      );
  }, [pois, south, north, west, east, stableViewport]);

  const { busStops, notBusStops } = useMemo(
    () => ({
      busStops: inBoundsPois.filter(isBusStop),
      notBusStops: inBoundsPois.filter(isNotBusStop),
    }),
    [inBoundsPois]
  );

  const placedPois = useMemo(() => {
    if (!stableViewport) return [];
    return getBySpacing(notBusStops, stableViewport, POI_MIN_DISTANCE_PX);
  }, [notBusStops, stableViewport]);

  const placedBusStops = useMemo(() => {
    if (!stableViewport) return [];
    return getBySpacing(busStops, stableViewport, BUS_STOP_MIN_DISTANCE_PX);
  }, [busStops, stableViewport]);

  if (!visible || !stableViewport) return null;

  return (
    <>
      {placedBusStops.map(({ poi }) => (
        <POIMarker key={poi.id} poi={poi} onClick={() => onClick(poi)} />
      ))}

      {placedPois.map(({ poi }) => (
        <POIMarker key={poi.id} poi={poi} onClick={() => onClick(poi)} />
      ))}
    </>
  );
}

import { useMemo } from "react";
import type { WebMercatorViewport } from "@deck.gl/core";
import { useDeckMapContext } from "@/components/Map/hooks";
import { usePois } from "@/hooks/usePois";
import POIMarker from "./POI/POI";
import type { POI } from "@/types";
import { isBusStop, isNotBusStop } from "./POI/helpers";

/** Minimum distance in pixels between regular POI markers to avoid overlap */
const POI_MIN_DISTANCE_PX = 80;

/** Minimum distance in pixels between bus stop markers to avoid overlap */
const BUS_STOP_MIN_DISTANCE_PX = 15;

/** Returns the Euclidean distance in pixels between two points. */
function distancePx(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function getBySpacing(items: POI[], viewport: WebMercatorViewport, minPxDistance: number) {
  const placed: Array<{ poi: POI; px: number; py: number }> = [];

  for (const poi of items) {
    const [lat, lng] = poi.coordinates;
    const [px, py] = viewport.project([lng, lat]);

    if (!isFinite(px) || !isFinite(py)) continue;

    const tooClose = placed.some(
      ({ px: x2, py: y2 }) => distancePx(px, py, x2, y2) < minPxDistance
    );
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
  const { viewport, getBoundingBox } = useDeckMapContext();

  // Get bounding box unconditionally to avoid hooks order issues
  const [[west, north], [east, south]] = getBoundingBox();

  // Memoize all calculations - they will run but results won't be used if not visible
  const inBoundsPois = useMemo(() => {
    if (!viewport) return [];

    return pois
      .filter((poi) => !!poi.name)
      .filter(
        ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
      );
  }, [pois, south, north, west, east, viewport]);

  const { busStops, notBusStops } = useMemo(
    () => ({
      busStops: inBoundsPois.filter(isBusStop),
      notBusStops: inBoundsPois.filter(isNotBusStop),
    }),
    [inBoundsPois]
  );

  const placedPois = useMemo(() => {
    if (!viewport) return [];
    return getBySpacing(notBusStops, viewport, POI_MIN_DISTANCE_PX);
  }, [notBusStops, viewport]);

  const placedBusStops = useMemo(() => {
    if (!viewport) return [];
    return getBySpacing(busStops, viewport, BUS_STOP_MIN_DISTANCE_PX);
  }, [busStops, viewport]);

  // Early return after all hooks have been called
  if (!visible || !viewport) return null;

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

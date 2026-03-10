import { useMemo } from "react";
import { useMapContext } from "@/components/Map/hooks";
import { usePois } from "@/hooks/usePois";
import POIMarker from "./POI/POI";
import type { POI } from "@/types";
import { isBusStop, isNotBusStop } from "./POI/helpers";
import type { GeoProjection, ZoomTransform } from "d3";

/** Minimum distance in pixels between regular POI markers to avoid overlap */
const POI_MIN_DISTANCE_PX = 80;

/** Minimum distance in pixels between bus stop markers to avoid overlap */
const BUS_STOP_MIN_DISTANCE_PX = 15;

/** Returns the Euclidean distance in pixels between two points. */
function distancePx(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function getBySpacing(
  items: POI[],
  transform: ZoomTransform,
  projection: GeoProjection,
  minPxDistance: number
) {
  const placedPois: Array<{
    poi: (typeof items)[number];
    px: number;
    py: number;
  }> = [];

  for (const poi of items) {
    const [lat, lng] = poi.coordinates;
    const projected = projection([lng, lat]);

    if (!projected) continue;
    const [px, py] = transform.apply(projected);

    const tooClose = placedPois.some(({ px: x2, py: y2 }) => {
      return distancePx(px, py, x2, y2) < minPxDistance;
    });
    if (!tooClose) {
      placedPois.push({ poi, px, py });
    }
  }
  return placedPois;
}

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { getBoundingBox, projection, transform } = useMapContext();

  // Get bounding box unconditionally to avoid hooks order issues
  const [[west, north], [east, south]] = getBoundingBox();

  // Memoize all calculations - they will run but results won't be used if not visible
  const inBoundsPois = useMemo(() => {
    if (!projection || !transform) return [];

    return pois
      .filter((poi) => !!poi.name)
      .filter(
        ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
      );
  }, [pois, south, north, west, east, projection, transform]);

  const { busStops, notBusStops } = useMemo(
    () => ({
      busStops: inBoundsPois.filter(isBusStop),
      notBusStops: inBoundsPois.filter(isNotBusStop),
    }),
    [inBoundsPois]
  );

  const placedPois = useMemo(() => {
    if (!projection || !transform) return [];
    return getBySpacing(notBusStops, transform, projection, POI_MIN_DISTANCE_PX);
  }, [notBusStops, transform, projection]);

  const placedBusStops = useMemo(() => {
    if (!projection || !transform) return [];
    return getBySpacing(busStops, transform, projection, BUS_STOP_MIN_DISTANCE_PX);
  }, [busStops, transform, projection]);

  // Early return after all hooks have been called
  if (!visible || !projection || !transform) return null;

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

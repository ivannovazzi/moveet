import { useMemo } from "react";
import { IconLayer } from "@deck.gl/layers";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { usePois } from "@/hooks/usePois";
import { createPOIIconAtlas } from "./POI/iconAtlas";
import { isBusStop } from "./POI/helpers";
import type { POI } from "@/types";

// Build the atlas once at module level — this is a pure canvas operation.
const { iconAtlas, iconMapping } = createPOIIconAtlas();

/** Zoom level below which POIs are hidden */
const POI_MIN_ZOOM = 4;
/** Zoom level below which bus stops are hidden (they need higher zoom) */
const BUS_STOP_MIN_ZOOM = 7;

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { getBoundingBox, getZoom } = useMapContext();
  const zoom = getZoom();

  const [[west, south], [east, north]] = getBoundingBox();

  const inBoundsPois = useMemo(() => {
    if (!visible || zoom < POI_MIN_ZOOM) return [];
    return pois.filter(
      (poi) =>
        !!poi.name &&
        poi.coordinates[0] >= south &&
        poi.coordinates[0] <= north &&
        poi.coordinates[1] >= west &&
        poi.coordinates[1] <= east &&
        // Hide bus stops at lower zoom levels
        (!isBusStop(poi) || zoom >= BUS_STOP_MIN_ZOOM)
    );
  }, [pois, south, north, west, east, visible, zoom]);

  const layers = useMemo(() => {
    if (inBoundsPois.length === 0) return [];

    return [
      new IconLayer<POI>({
        id: "pois",
        data: inBoundsPois,
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => (d.type && d.type in iconMapping ? d.type : "unknown"),
        getSize: (d) => (isBusStop(d) ? 14 : 22),
        iconAtlas,
        iconMapping,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
        onClick: (info) => {
          if (info.object) {
            onClick(info.object);
            return true; // stop event propagation
          }
          return false;
        },
        sizeUnits: "pixels",
        sizeMinPixels: 8,
        sizeMaxPixels: 36,
      }),
    ];
  }, [inBoundsPois, onClick]);

  useRegisterLayers("pois", layers, 45);

  return null;
}

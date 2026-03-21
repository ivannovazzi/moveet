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

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { getBoundingBox } = useMapContext();

  const [[west, south], [east, north]] = getBoundingBox();

  const inBoundsPois = useMemo(() => {
    if (!visible) return [];
    return pois.filter(
      (poi) =>
        !!poi.name &&
        poi.coordinates[0] >= south &&
        poi.coordinates[0] <= north &&
        poi.coordinates[1] >= west &&
        poi.coordinates[1] <= east
    );
  }, [pois, south, north, west, east, visible]);

  const layers = useMemo(() => {
    if (!visible || inBoundsPois.length === 0) return [];

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
        onClick: (info) => {
          if (info.object) onClick(info.object);
        },
        sizeUnits: "pixels",
        sizeMinPixels: 10,
        sizeMaxPixels: 30,
        updateTriggers: {
          getPosition: [inBoundsPois],
        },
      }),
    ];
  }, [visible, inBoundsPois, onClick]);

  useRegisterLayers("pois", layers, 45);

  return null;
}

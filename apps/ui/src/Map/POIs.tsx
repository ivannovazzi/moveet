import { useMemo } from "react";
import { IconLayer } from "@deck.gl/layers";
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from "@deck.gl/extensions";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { usePois } from "@/hooks/usePois";
import { createPOIIconAtlas } from "./POI/iconAtlas";
import { isBusStop } from "./POI/helpers";
import type { POI } from "@/types";

// Build the atlas once at module level — this is a pure canvas operation.
const { iconAtlas, iconMapping } = createPOIIconAtlas();

const collisionFilter = new CollisionFilterExtension();

/**
 * Progressive zoom tiers — the closer you get, the more is revealed.
 * Major landmarks first, minor points and bus stops only at street level.
 */
const ZOOM_TIERS: Record<string, number> = {
  shop: 13,
  office: 13,
  leisure: 14,
  craft: 15,
  unknown: 15,
  bus_stop: 16,
};
const MIN_ZOOM = 13;

/** POI collision priority — higher values win when icons overlap. */
const TYPE_PRIORITY: Record<string, number> = {
  shop: 6,
  office: 5,
  leisure: 4,
  craft: 3,
  unknown: 2,
  bus_stop: 1,
};

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
    if (!visible || zoom < MIN_ZOOM) return [];
    return pois.filter(
      (poi) =>
        !!poi.name &&
        poi.coordinates[0] >= south &&
        poi.coordinates[0] <= north &&
        poi.coordinates[1] >= west &&
        poi.coordinates[1] <= east &&
        zoom >= (ZOOM_TIERS[poi.type ?? "unknown"] ?? MIN_ZOOM)
    );
  }, [pois, south, north, west, east, visible, zoom]);

  const layers = useMemo(() => {
    if (inBoundsPois.length === 0) return [];

    return [
      new IconLayer<POI, CollisionFilterExtensionProps<POI>>({
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
        extensions: [collisionFilter],
        ...({
          collisionEnabled: true,
          collisionGroup: "poi-markers",
          getCollisionPriority: (d: POI) => TYPE_PRIORITY[d.type ?? "unknown"] ?? 0,
        } as Record<string, unknown>),
      }),
    ];
  }, [inBoundsPois, onClick]);

  useRegisterLayers("pois", layers, 45);

  return null;
}

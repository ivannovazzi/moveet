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
 * Each type fades in over one zoom level past its threshold.
 */
const ZOOM_TIERS: Record<string, number> = {
  shop: 7,
  office: 7,
  leisure: 7.5,
  craft: 8,
  unknown: 8,
  bus_stop: 9,
};
const MIN_ZOOM = 7;

/** POI collision priority — higher values win when icons overlap. */
const TYPE_PRIORITY: Record<string, number> = {
  shop: 6,
  office: 5,
  leisure: 4,
  craft: 3,
  unknown: 2,
  bus_stop: 1,
};

/**
 * Collision spacing multiplier — how much larger the collision hitbox is
 * compared to the rendered icon. 1.0 = no extra spacing, 2.0 = double.
 */
const COLLISION_SIZE_SCALE = 2.0;

/** Fade-in duration in milliseconds. */
const FADE_DURATION_MS = 500;

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { getBoundingBox, getZoom } = useMapContext();
  const zoom = getZoom();

  const [[west, south], [east, north]] = getBoundingBox();

  // Always include all in-bounds POIs so deck.gl can transition their alpha.
  // Visibility is controlled purely by getColor alpha below.
  const inBoundsPois = useMemo(() => {
    if (!visible || zoom < MIN_ZOOM) return [];
    return pois.filter(
      (poi) =>
        !!poi.name &&
        poi.coordinates[0] >= south &&
        poi.coordinates[0] <= north &&
        poi.coordinates[1] >= west &&
        poi.coordinates[1] <= east
    );
  }, [pois, south, north, west, east, visible, zoom]);

  const layers = useMemo(() => {
    if (inBoundsPois.length === 0) return [];

    return [
      new IconLayer<POI, CollisionFilterExtensionProps<POI>>({
        id: "pois",
        data: inBoundsPois,
        updateTriggers: {
          getColor: [zoom],
        },
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => (d.type && d.type in iconMapping ? d.type : "unknown"),
        getSize: (d) => (isBusStop(d) ? 14 : 22),
        // Fade in: alpha ramps 0→255 over one zoom level past the tier threshold.
        // Items below their tier are fully transparent (hidden).
        getColor: (d) => {
          const tier = ZOOM_TIERS[d.type ?? "unknown"] ?? MIN_ZOOM;
          const alpha = Math.round(Math.max(0, Math.min(1, zoom - tier)) * 255);
          return [255, 255, 255, alpha];
        },
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
        transitions: { getColor: { duration: FADE_DURATION_MS } },
        extensions: [collisionFilter],
        ...({
          collisionEnabled: true,
          collisionGroup: "poi-markers",
          getCollisionPriority: (d: POI) => TYPE_PRIORITY[d.type ?? "unknown"] ?? 0,
          collisionTestProps: { sizeScale: COLLISION_SIZE_SCALE },
        } as Record<string, unknown>),
      }),
    ];
  }, [inBoundsPois, onClick, zoom]);

  useRegisterLayers("pois", layers, 45);

  return null;
}

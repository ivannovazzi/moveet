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
const COLLISION_SIZE_SCALE = 4.0;

/** Fade-in duration in milliseconds. */
const FADE_DURATION_MS = 800;

/**
 * Zoom is quantized to discrete steps so deck.gl color transitions can
 * complete between updates instead of restarting on every animation frame.
 */
const ZOOM_STEP = 0.5;

interface POIMarkerProps {
  visible: boolean;
  onClick: (poi: POI) => void;
}

export default function POIs({ visible, onClick }: POIMarkerProps) {
  const { pois } = usePois();
  const { getZoom } = useMapContext();
  const zoom = getZoom();

  const showData = visible && zoom >= MIN_ZOOM - 1;
  const quantizedZoom = Math.floor(zoom / ZOOM_STEP) * ZOOM_STEP;

  // Keep the data array stable across zoom/pan so deck.gl enter transitions
  // only fire once per item, not on every viewport change.
  const visiblePois = useMemo(
    () => (showData ? pois.filter((poi) => !!poi.name) : []),
    [pois, showData]
  );

  // Always create the layer so deck.gl preserves transition state across
  // data changes. Returning [] would destroy the layer and lose all
  // in-flight enter/color transitions.
  const layers = useMemo(
    () => [
      new IconLayer<POI, CollisionFilterExtensionProps<POI>>({
        id: "pois",
        data: visiblePois,
        updateTriggers: {
          getColor: [quantizedZoom],
        },
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => (d.type && d.type in iconMapping ? d.type : "unknown"),
        getSize: (d) => (isBusStop(d) ? 14 : 22),
        getColor: (d) => {
          const tier = ZOOM_TIERS[d.type ?? "unknown"] ?? MIN_ZOOM;
          const alpha = Math.round(Math.max(0, Math.min(1, quantizedZoom - tier)) * 255);
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
        transitions: {
          getColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
        extensions: [collisionFilter],
        ...({
          collisionEnabled: true,
          collisionGroup: "map-markers",
          getCollisionPriority: (d: POI) => TYPE_PRIORITY[d.type ?? "unknown"] ?? 0,
          collisionTestProps: {
            sizeScale: COLLISION_SIZE_SCALE,
            sizeMaxPixels: 200,
          },
        } as Record<string, unknown>),
      }),
    ],
    [visiblePois, onClick, quantizedZoom]
  );

  useRegisterLayers("pois", layers, 45);

  return null;
}

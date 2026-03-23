import { useMemo } from "react";
import { IconLayer } from "@deck.gl/layers";
import { CollisionFilterExtension, type CollisionFilterExtensionProps } from "@deck.gl/extensions";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useSpeedLimits, type SpeedLimitSign } from "@/hooks/useSpeedLimits";
import { createSpeedLimitIconAtlas, speedToIconKey } from "./POI/iconAtlas";

// Build the atlas once at module level.
const { iconAtlas, iconMapping } = createSpeedLimitIconAtlas();

const collisionFilter = new CollisionFilterExtension();

/** Zoom level below which speed limit signs are hidden */
const MIN_ZOOM = 7;

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

/** Collision priority — sits between POI craft (3) and office (5). */
const SPEED_LIMIT_PRIORITY = 4;

interface SpeedLimitSignsProps {
  visible: boolean;
}

export default function SpeedLimitSigns({ visible }: SpeedLimitSignsProps) {
  const { signs } = useSpeedLimits();
  const { getZoom } = useMapContext();
  const zoom = getZoom();

  const showData = visible && zoom >= MIN_ZOOM - 1;
  const quantizedZoom = Math.floor(zoom / ZOOM_STEP) * ZOOM_STEP;

  // Stable data array — no viewport filtering — so enter transitions fire once.
  const visibleSigns = useMemo(() => (showData ? signs : []), [signs, showData]);

  // Always create the layer so deck.gl preserves transition state.
  const layers = useMemo(() => {
    const alpha = Math.round(Math.max(0, Math.min(1, quantizedZoom - MIN_ZOOM)) * 255);

    return [
      new IconLayer<SpeedLimitSign, CollisionFilterExtensionProps>({
        id: "speed-limit-signs",
        data: visibleSigns,
        updateTriggers: {
          getColor: [quantizedZoom],
        },
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => speedToIconKey(d.speed),
        getSize: 28,
        getColor: () => [255, 255, 255, alpha],
        iconAtlas,
        iconMapping,
        pickable: false,
        sizeUnits: "pixels",
        sizeMinPixels: 14,
        sizeMaxPixels: 32,
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
          getCollisionPriority: () => SPEED_LIMIT_PRIORITY,
          collisionTestProps: {
            sizeScale: COLLISION_SIZE_SCALE,
            sizeMaxPixels: 200,
          },
        } as Record<string, unknown>),
      }),
    ];
  }, [visibleSigns, quantizedZoom]);

  useRegisterLayers("speed-limit-signs", layers, 46);

  return null;
}

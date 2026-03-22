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
const COLLISION_SIZE_SCALE = 2.0;

/** Fade-in duration in milliseconds. */
const FADE_DURATION_MS = 500;

interface SpeedLimitSignsProps {
  visible: boolean;
}

export default function SpeedLimitSigns({ visible }: SpeedLimitSignsProps) {
  const { signs } = useSpeedLimits();
  const { getBoundingBox, getZoom } = useMapContext();
  const zoom = getZoom();

  const [[west, south], [east, north]] = getBoundingBox();

  const inBounds = useMemo(() => {
    if (!visible || zoom < MIN_ZOOM) return [];
    return signs.filter(
      ({ coordinates: [lat, lng] }) => lat >= south && lat <= north && lng >= west && lng <= east
    );
  }, [signs, south, north, west, east, visible, zoom]);

  const layers = useMemo(() => {
    if (inBounds.length === 0) return [];

    // Fade in: alpha ramps 0→255 over one zoom level past threshold
    const alpha = Math.round(Math.max(0, Math.min(1, zoom - MIN_ZOOM)) * 255);

    return [
      new IconLayer<SpeedLimitSign, CollisionFilterExtensionProps>({
        id: "speed-limit-signs",
        data: inBounds,
        updateTriggers: {
          getColor: [zoom],
        },
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => speedToIconKey(d.speed),
        getSize: 28,
        getColor: [255, 255, 255, alpha],
        iconAtlas,
        iconMapping,
        pickable: false,
        sizeUnits: "pixels",
        sizeMinPixels: 14,
        sizeMaxPixels: 32,
        transitions: { getColor: { duration: FADE_DURATION_MS } },
        extensions: [collisionFilter],
        ...({
          collisionEnabled: true,
          collisionGroup: "speed-signs",
          collisionTestProps: { sizeScale: COLLISION_SIZE_SCALE },
        } as Record<string, unknown>),
      }),
    ];
  }, [inBounds, zoom]);

  useRegisterLayers("speed-limit-signs", layers, 46);

  return null;
}

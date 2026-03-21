import { useMemo } from "react";
import { IconLayer } from "@deck.gl/layers";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useSpeedLimits, type SpeedLimitSign } from "@/hooks/useSpeedLimits";
import { createSpeedLimitIconAtlas, speedToIconKey } from "./POI/iconAtlas";

// Build the atlas once at module level.
const { iconAtlas, iconMapping } = createSpeedLimitIconAtlas();

/** Zoom level below which speed limit signs are hidden */
const MIN_ZOOM = 6;

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

    return [
      new IconLayer<SpeedLimitSign>({
        id: "speed-limit-signs",
        data: inBounds,
        getPosition: (d) => [d.coordinates[1], d.coordinates[0]],
        getIcon: (d) => speedToIconKey(d.speed),
        getSize: 28,
        iconAtlas,
        iconMapping,
        pickable: false,
        sizeUnits: "pixels",
        sizeMinPixels: 14,
        sizeMaxPixels: 32,
      }),
    ];
  }, [inBounds]);

  useRegisterLayers("speed-limit-signs", layers, 46);

  return null;
}

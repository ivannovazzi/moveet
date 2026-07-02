import { useMemo } from "react";
import { PolygonLayer } from "@deck.gl/layers";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";
import type { Heatzone } from "@/types";

/** Fade in/out duration in milliseconds, matching SpeedLimitSigns. */
const FADE_DURATION_MS = 500;

interface HeatzoneDatum {
  polygon: [number, number][];
  intensity: number;
}

const DENSITY_LINE_RGBA = resolveMapColor("var(--color-overlay-density)", 153);

export default function Heatzones({ visible }: { visible: boolean }) {
  const heatzones = useHeatzones();

  const layers = useMemo(() => {
    if (!visible || heatzones.length === 0) return [];

    const data: HeatzoneDatum[] = heatzones.map((heatzone: Heatzone) => ({
      polygon: heatzone.geometry.coordinates as [number, number][],
      intensity: heatzone.properties.intensity,
    }));

    return [
      new PolygonLayer<HeatzoneDatum>({
        id: "traffic-zones",
        data,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => {
          const [r, g, b] = resolveMapColor("var(--color-overlay-density)");
          return [r, g, b, Math.round(0.2 * d.intensity * 255)];
        },
        getLineColor: DENSITY_LINE_RGBA,
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
        transitions: {
          getFillColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
          getLineColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
      }),
    ];
  }, [visible, heatzones]);

  useRegisterLayers("traffic-zones", layers);

  return null;
}

import { useMemo } from "react";
import { PolygonLayer } from "@deck.gl/layers";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import type { Heatzone } from "@/types";

interface HeatzoneDatum {
  polygon: [number, number][];
  intensity: number;
}

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
        getFillColor: (d) => [255, 0, 0, Math.round(0.2 * d.intensity * 255)],
        getLineColor: [255, 0, 0, 153], // #ff000099
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
      }),
    ];
  }, [visible, heatzones]);

  useRegisterLayers("traffic-zones", layers);

  return null;
}

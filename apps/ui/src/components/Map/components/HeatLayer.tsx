import { useMemo } from "react";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import type { Position } from "@/types";

interface HeatLayerProps {
  data: Position[];
  opacity?: number;
}

export default function HeatLayer({ data, opacity = 0.5 }: HeatLayerProps) {
  const layers = useMemo(() => {
    if (data.length === 0) return [];

    return [
      new HeatmapLayer<Position>({
        id: "heatmap",
        data,
        getPosition: (d: Position) => d,
        getWeight: 1,
        radiusPixels: 30,
        intensity: 1,
        colorRange: [
          [0, 255, 0],
          [128, 255, 0],
          [255, 255, 0],
          [255, 128, 0],
          [255, 0, 0],
        ],
        opacity,
        debounceTimeout: 500,
        weightsTextureSize: 512,
        pickable: false,
      }),
    ];
  }, [data, opacity]);

  useRegisterLayers("heatmap", layers);

  return null;
}

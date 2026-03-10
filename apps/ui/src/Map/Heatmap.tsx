import type { Vehicle } from "@/types";
import HeatLayer from "@/components/Map/components/HeatLayer";

interface HeatmapProps {
  vehicles: Vehicle[];
}

export default function Heatmap({ vehicles }: HeatmapProps) {
  return (
    <HeatLayer
      data={vehicles.map((v) => v.position)}
      bandwidth={10}
      opacity={0.02}
      thresholds={50}
    />
  );
}

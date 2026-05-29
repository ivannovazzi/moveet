import { useMemo } from "react";
import type { Vehicle } from "@/types";
import HeatLayer from "@/components/Map/components/HeatLayer";

interface HeatmapProps {
  vehicles: Vehicle[];
}

export default function Heatmap({ vehicles }: HeatmapProps) {
  // Memoize the position array so HeatLayer's layer-building useMemo (keyed on
  // `data`) isn't busted every render, which would rebuild the deck.gl
  // HeatmapLayer and discard its aggregation each frame.
  const data = useMemo(() => vehicles.map((v) => v.position), [vehicles]);
  return <HeatLayer data={data} />;
}

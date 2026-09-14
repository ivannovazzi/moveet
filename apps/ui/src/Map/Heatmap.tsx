import { useMemo } from "react";
import type { Vehicle } from "@/types";
import HeatLayer, { heatColorRange } from "@/components/Map/components/HeatLayer";
import { Flame } from "@/components/Icons";
import ScaleLegend from "./ScaleLegend";
import { renderInSlot, useLegendSlot, type LegendSlot } from "./LegendStack";

interface HeatmapProps {
  vehicles: Vehicle[];
  /** Where the legend is portalled; inline when absent (tests, no stack yet). */
  legendSlot?: LegendSlot;
}

export default function Heatmap({ vehicles, legendSlot }: HeatmapProps) {
  const slot = useLegendSlot();
  // Memoize the position array so HeatLayer's layer-building useMemo (keyed on
  // `data`) isn't busted every render, which would rebuild the deck.gl
  // HeatmapLayer and discard its aggregation each frame.
  const data = useMemo(() => vehicles.map((v) => v.position), [vehicles]);

  // The same array reference the layer is handed, so the legend cannot drift
  // from the map.
  const colorRange = useMemo(() => heatColorRange(), []);

  return (
    <>
      <HeatLayer data={data} />
      {renderInSlot(
        legendSlot ?? slot,
        "heat",
        <ScaleLegend
          testId="heat-legend"
          title="Vehicle heat"
          subtitle="Recent positions"
          icon={Flame}
          colorRange={colorRange}
          // The kernel is a smoothed density field, not a binned count: deck.gl
          // never reports a domain for it, and inventing one would be a legend
          // that lies about a scale the reader can't verify.
          domain={null}
        />
      )}
    </>
  );
}

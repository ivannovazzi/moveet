import { useEffect, useRef, useMemo } from "react";
import { contourDensity, scaleSequential, interpolateRgb, max, select, geoPath } from "d3";
import type { ContourMultiPolygon } from "d3";
import { useMapContext } from "@/components/Map/hooks";
import type { Position } from "@/types";

interface HeatLayerProps {
  data: Position[];
  bandwidth?: number;
  opacity?: number;
  thresholds?: number;
  debounceMs?: number;
}

export default function HeatLayer({
  data,
  bandwidth = 10,
  opacity = 0.02,
  thresholds = 50,
  debounceMs = 800,
}: HeatLayerProps) {
  const { projection } = useMapContext();
  const heatmapRef = useRef<SVGGElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Memoize density generator
  const density = useMemo(
    () =>
      contourDensity<Position>()
        .x((d) => d[0])
        .y((d) => d[1])
        .bandwidth(bandwidth)
        .thresholds(thresholds)
        .size([1300, 1000]),
    [bandwidth, thresholds]
  );

  // Simple color interpolator
  const colorScale = useMemo(
    () => scaleSequential().interpolator(interpolateRgb("#00ff00", "#ff0000")),
    []
  );

  useEffect(() => {
    if (!projection || !heatmapRef.current || data.length === 0) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!heatmapRef.current) return;

      const points = data.map((v) => projection(v) ?? [0, 0]) as Position[];
      const contours = density(points);

      colorScale.domain([0, max(contours, (d) => d.value) ?? 1]);

      const heatGroup = select(heatmapRef.current);
      const paths = heatGroup.selectAll<SVGPathElement, ContourMultiPolygon>("path").data(contours);

      paths.exit().remove();

      paths
        .enter()
        .append("path")
        .merge(paths)
        .attr("d", geoPath())
        .attr("fill", (d) => colorScale(d.value))
        .attr("opacity", opacity)
        .attr("stroke", "none");
    }, debounceMs);

    return () => clearTimeout(timerRef.current);
  }, [data, projection, density, colorScale, opacity, debounceMs]);

  return <g ref={heatmapRef} className="heatmap-layer" />;
}

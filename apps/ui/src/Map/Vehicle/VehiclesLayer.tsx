import { useEffect, useRef, useCallback } from "react";
import { select } from "d3";
import type { Vehicle, Position } from "@/types";
import { useMapContext } from "../../components/Map/hooks";

const VEHICLE_POINTS = "0,-4 2.5,3 0,1.5 -2.5,3";

interface VehiclesLayerProps {
  vehicles: Vehicle[];
  scale: number;
  vehicleFleetColors: Map<string, string | undefined>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/**
 * High-performance vehicle renderer using D3 data joins.
 *
 * Key design: no D3 transitions, no per-vehicle timers.
 * At 100ms WS batch intervals, direct attribute setting gives smooth-enough
 * movement. Zoom/pan is handled by the parent g.markers transform — this
 * component never re-runs on zoom.
 */
export default function VehiclesLayer({
  vehicles,
  scale,
  vehicleFleetColors,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const groupRef = useRef<SVGGElement>(null);
  const { projection, transform } = useMapContext();
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  const projectPosition = useCallback(
    (pos: Position): [number, number] | null => {
      if (!projection) return null;
      const result = projection(pos);
      if (!result || !isFinite(result[0]) || !isFinite(result[1])) return null;
      return result as [number, number];
    },
    [projection],
  );

  // Effect 1: Position + structure updates (runs on vehicle data changes only)
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !projection) return;

    const visibleVehicles = vehicles.filter((v) => v.visible);

    // Data join keyed by vehicle id
    const groups = select(g)
      .selectAll<SVGGElement, Vehicle>("g.v")
      .data(visibleVehicles, (d) => d.id);

    // EXIT
    groups.exit().remove();

    // ENTER
    const enter = groups
      .enter()
      .append("g")
      .attr("class", "v")
      .style("cursor", "pointer")
      .each(function (this: SVGGElement) {
        const inner = select(this).append("g").attr("class", "inner");
        inner.append("polygon").attr("points", VEHICLE_POINTS).attr("stroke-width", 0.5);
        inner
          .append("circle")
          .attr("class", "ring")
          .attr("r", 6)
          .style("display", "none");
      })
      .on("click", function (_event: MouseEvent, d: Vehicle) {
        onClickRef.current(d.id);
      });

    // ENTER + UPDATE: set positions directly, no transitions
    enter.merge(groups).each(function (this: SVGGElement, d) {
      const el = select<SVGGElement, Vehicle>(this);
      const projected = projectPosition(d.position);
      if (!projected) {
        el.style("visibility", "hidden");
        return;
      }
      el.style("visibility", "visible");
      el.attr("transform", `translate(${projected[0]},${projected[1]})`);

      // Rotation (no zoom scale here — handled by Effect 2)
      el.select<SVGGElement>("g.inner").attr(
        "transform",
        `rotate(${d.heading ?? 0}) scale(${el.attr("data-scale") || 1})`,
      );
    });
  }, [vehicles, projection, projectPosition]);

  // Effect 2: Zoom compensation only (runs on zoom changes, lightweight)
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;

    const k = transform?.k ?? 1;
    const inverseScale = scale / Math.pow(k, 0.75);

    // Update all inner groups with new scale — no data join, just selectAll
    select(g)
      .selectAll<SVGGElement, Vehicle>("g.v")
      .each(function (this: SVGGElement, d) {
        const inner = select(this).select<SVGGElement>("g.inner");
        inner
          .attr("data-scale", inverseScale)
          .attr("transform", `rotate(${d?.heading ?? 0}) scale(${inverseScale})`);
      });
  }, [transform, scale]);

  // Effect 3: Selection/hover styling (runs only when selection changes)
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;

    select(g)
      .selectAll<SVGGElement, Vehicle>("g.v")
      .each(function (this: SVGGElement, d) {
        const inner = select(this).select<SVGGElement>("g.inner");
        const isSelected = d.id === selectedId;
        const isHovered = d.id === hoveredId;
        const fleetColor = vehicleFleetColors.get(d.id);

        inner
          .select<SVGPolygonElement>("polygon")
          .attr("fill", fleetColor ?? "var(--color-vehicle-fill)")
          .attr(
            "stroke",
            isSelected
              ? "var(--color-vehicle-selected-stroke)"
              : isHovered
                ? "var(--color-vehicle-hover-stroke)"
                : "var(--color-vehicle-stroke)",
          )
          .attr("stroke-width", isSelected || isHovered ? 0.8 : 0.5)
          .attr(
            "filter",
            isSelected
              ? "drop-shadow(0 0 4px var(--color-vehicle-selected-stroke))"
              : isHovered
                ? "drop-shadow(0 0 3px var(--color-vehicle-hover-stroke))"
                : null,
          );

        inner
          .select<SVGCircleElement>("circle.ring")
          .style("display", isSelected ? "block" : "none")
          .attr("fill", "var(--color-vehicle-selected-bg)")
          .attr("stroke", "var(--color-vehicle-selected-stroke)")
          .attr("stroke-width", 0.4);
      });
  }, [selectedId, hoveredId, vehicleFleetColors]);

  return <g ref={groupRef} />;
}

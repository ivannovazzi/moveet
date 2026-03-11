import { useEffect, useRef, useCallback } from "react";
import { select, transition } from "d3";
import type { Vehicle, Position } from "@/types";
import { useMapContext } from "../../components/Map/hooks";

// Reuse the same polygon shape as the original VehicleMarker
const VEHICLE_POINTS = "0,-4 2.5,3 0,1.5 -2.5,3";

interface VehiclesLayerProps {
  vehicles: Vehicle[];
  animFreq: number;
  scale: number;
  vehicleFleetColors: Map<string, string | undefined>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/**
 * High-performance vehicle renderer using D3 data joins instead of
 * individual React components. Eliminates per-vehicle hooks, context
 * subscriptions, and React reconciliation overhead.
 */
export default function VehiclesLayer({
  vehicles,
  animFreq,
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

  // Track which vehicles have been placed (for initial position, no transition)
  const placedRef = useRef(new Set<string>());

  const projectPosition = useCallback(
    (pos: Position): [number, number] | null => {
      if (!projection) return null;
      const result = projection(pos);
      if (!result || !isFinite(result[0]) || !isFinite(result[1])) return null;
      return result as [number, number];
    },
    [projection],
  );

  // Main D3 data join effect
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !projection) return;

    const k = transform?.k ?? 1;
    const zoomCompensation = Math.pow(k, 0.75);
    const inverseScale = scale / zoomCompensation;
    const placed = placedRef.current;

    // Data join keyed by vehicle id
    const groups = select(g)
      .selectAll<SVGGElement, Vehicle>("g.v")
      .data(
        vehicles.filter((v) => v.visible),
        (d) => d.id,
      );

    // EXIT: remove vehicles no longer in the data
    groups.exit().remove();

    // ENTER: create new vehicle groups
    const enter = groups
      .enter()
      .append("g")
      .attr("class", "v")
      .style("cursor", "pointer")
      .each(function (this: SVGGElement, d) {
        const projected = projectPosition(d.position);
        if (projected) {
          select(this)
            .attr("transform", `translate(${projected[0]},${projected[1]})`)
            .style("visibility", "visible");
        } else {
          select(this).style("visibility", "hidden");
        }

        // Inner group for rotation + scale
        const inner = select(this).append("g").attr("class", "inner");

        inner
          .append("polygon")
          .attr("points", VEHICLE_POINTS)
          .attr("stroke-width", 0.5)
          .style("cursor", "pointer");

        // Selection ring (hidden by default)
        inner
          .append("circle")
          .attr("class", "ring")
          .attr("r", 6)
          .style("display", "none");
      })
      .on("click", function (_event: MouseEvent, d: Vehicle) {
        onClickRef.current(d.id);
      });

    // ENTER + UPDATE: update all vehicle positions and styles
    const merged = enter.merge(groups);

    merged.each(function (this: SVGGElement, d) {
      const el = select<SVGGElement, Vehicle>(this);
      const projected = projectPosition(d.position);
      if (!projected) {
        el.style("visibility", "hidden");
        return;
      }
      el.style("visibility", "visible");

      const isNew = !placed.has(d.id);

      if (isNew) {
        // First appearance: snap to position, no transition
        el.attr("transform", `translate(${projected[0]},${projected[1]})`);
        placed.add(d.id);
      } else {
        // Existing vehicle: smooth transition
        el.transition(transition().duration(animFreq))
          .ease((t) => t) // linear
          .attr("transform", `translate(${projected[0]},${projected[1]})`);
      }

      // Update inner group: rotation + zoom-compensated scale
      const heading = d.heading ?? 0;
      const inner = el.select<SVGGElement>("g.inner");
      if (isNew) {
        inner.attr("transform", `rotate(${heading}) scale(${inverseScale})`);
      } else {
        inner
          .transition(transition().duration(animFreq))
          .ease((t) => t)
          .attr("transform", `rotate(${heading}) scale(${inverseScale})`);
      }

      // Update polygon style
      const poly = inner.select<SVGPolygonElement>("polygon");
      const isSelected = d.id === selectedId;
      const isHovered = d.id === hoveredId;
      const fleetColor = vehicleFleetColors.get(d.id);

      poly
        .attr("fill", fleetColor ?? "var(--color-vehicle-fill)")
        .attr("stroke", () => {
          if (isSelected) return "var(--color-vehicle-selected-stroke)";
          if (isHovered) return "var(--color-vehicle-hover-stroke)";
          return "var(--color-vehicle-stroke)";
        })
        .attr("stroke-width", isSelected || isHovered ? 0.8 : 0.5)
        .attr(
          "filter",
          isSelected
            ? "drop-shadow(0 0 4px var(--color-vehicle-selected-stroke))"
            : isHovered
              ? "drop-shadow(0 0 3px var(--color-vehicle-hover-stroke))"
              : null,
        );

      // Selection ring
      const ring = inner.select<SVGCircleElement>("circle.ring");
      ring
        .style("display", isSelected ? "block" : "none")
        .attr("fill", "var(--color-vehicle-selected-bg)")
        .attr("stroke", "var(--color-vehicle-selected-stroke)")
        .attr("stroke-width", 0.4);
    });

    // Clean up placed set for removed vehicles
    const activeIds = new Set(vehicles.map((v) => v.id));
    for (const id of placed) {
      if (!activeIds.has(id)) placed.delete(id);
    }
  }, [vehicles, projection, transform, animFreq, scale, selectedId, hoveredId, vehicleFleetColors, projectPosition]);

  return <g ref={groupRef} />;
}

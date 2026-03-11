import { useEffect, useRef, useCallback, useMemo } from "react";
import { select } from "d3";
import type { Vehicle, Position } from "@/types";
import { useMapContext } from "../../components/Map/hooks";

// Arrow shape vertices (same as original VehicleMarker polygon)
const AX = [0, 2.5, 0, -2.5];
const AY = [-4, 3, 1.5, 3];

interface VehiclesLayerProps {
  vehicles: Vehicle[];
  scale: number;
  vehicleFleetColors: Map<string, string | undefined>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/** Projected vehicle with screen coords for hit testing. */
interface ProjectedVehicle {
  id: string;
  x: number;
  y: number;
}

/**
 * Batched SVG path renderer for vehicles.
 *
 * Instead of 800 individual SVG elements, renders one <path> per fleet color.
 * 800 vehicles → ~10 DOM elements. Click handled via hit-test on projected coords.
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
  const projectedRef = useRef<ProjectedVehicle[]>([]);
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

  // Visible vehicles filtered once
  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => v.visible),
    [vehicles],
  );

  // Build batched path strings grouped by fill color.
  // Also builds projected positions for hit testing.
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !projection) return;

    const k = transform?.k ?? 1;
    const s = scale / Math.pow(k, 0.75);

    // Group vehicles by fill color
    const colorGroups = new (globalThis.Map)<string, string>();
    const projected: ProjectedVehicle[] = [];
    let selectedPath = "";
    let hoveredPath = "";

    for (const v of visibleVehicles) {
      const pos = projectPosition(v.position);
      if (!pos) continue;

      const [x, y] = pos;
      projected.push({ id: v.id, x, y });

      // Build arrow path data: rotate + scale + translate each vertex
      const heading = ((v.heading ?? 0) * Math.PI) / 180;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);

      let d = "";
      for (let i = 0; i < 4; i++) {
        const rx = (AX[i] * cos - AY[i] * sin) * s + x;
        const ry = (AX[i] * sin + AY[i] * cos) * s + y;
        d += i === 0 ? `M${rx},${ry}` : `L${rx},${ry}`;
      }
      d += "Z";

      // Selected/hovered get their own path for separate styling
      if (v.id === selectedId) {
        selectedPath += d;
      } else if (v.id === hoveredId) {
        hoveredPath += d;
      } else {
        const color = vehicleFleetColors.get(v.id) ?? "var(--color-vehicle-fill)";
        const existing = colorGroups.get(color);
        colorGroups.set(color, existing ? existing + d : d);
      }
    }

    projectedRef.current = projected;

    // Render: one <path> per color group + selected + hovered
    const container = select(g);

    // Data join on color groups
    const entries = Array.from(colorGroups.entries());
    const paths = container.selectAll<SVGPathElement, [string, string]>("path.fleet")
      .data(entries, (d) => d[0]);

    paths.exit().remove();

    paths.enter()
      .append("path")
      .attr("class", "fleet")
      .attr("stroke", "var(--color-vehicle-stroke)")
      .attr("stroke-width", 0.5)
      .merge(paths)
      .attr("d", (d) => d[1])
      .attr("fill", (d) => d[0]);

    // Selected vehicle path
    let selPath = container.select<SVGPathElement>("path.selected");
    if (selectedPath) {
      if (selPath.empty()) {
        selPath = container.append("path")
          .attr("class", "selected")
          .attr("stroke", "var(--color-vehicle-selected-stroke)")
          .attr("stroke-width", 0.8)
          .attr("filter", "drop-shadow(0 0 4px var(--color-vehicle-selected-stroke))");
      }
      const selColor = vehicleFleetColors.get(selectedId!) ?? "var(--color-vehicle-fill)";
      selPath.attr("d", selectedPath).attr("fill", selColor);
    } else {
      selPath.remove();
    }

    // Selection ring (circle around selected vehicle)
    let ring = container.select<SVGCircleElement>("circle.ring");
    if (selectedId) {
      const selVehicle = projected.find((p) => p.id === selectedId);
      if (selVehicle) {
        if (ring.empty()) {
          ring = container.append("circle")
            .attr("class", "ring")
            .attr("fill", "var(--color-vehicle-selected-bg)")
            .attr("stroke", "var(--color-vehicle-selected-stroke)")
            .attr("stroke-width", 0.4 * s);
        }
        ring.attr("cx", selVehicle.x).attr("cy", selVehicle.y).attr("r", 6 * s);
      }
    } else {
      ring.remove();
    }

    // Hovered vehicle path
    let hovPath = container.select<SVGPathElement>("path.hovered");
    if (hoveredPath) {
      if (hovPath.empty()) {
        hovPath = container.append("path")
          .attr("class", "hovered")
          .attr("stroke", "var(--color-vehicle-hover-stroke)")
          .attr("stroke-width", 0.8)
          .attr("filter", "drop-shadow(0 0 3px var(--color-vehicle-hover-stroke))");
      }
      const hovColor = vehicleFleetColors.get(hoveredId!) ?? "var(--color-vehicle-fill)";
      hovPath.attr("d", hoveredPath).attr("fill", hovColor);
    } else {
      hovPath.remove();
    }
  }, [visibleVehicles, projection, transform, scale, selectedId, hoveredId,
      vehicleFleetColors, projectPosition]);

  // Hit testing: find nearest vehicle to click position
  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      if (!projection || !transform) return;

      const g = groupRef.current;
      if (!g) return;

      // Get click position in SVG coordinate space (untransformed)
      const svg = g.ownerSVGElement;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const svgPt = pt.matrixTransform(g.getScreenCTM()?.inverse());

      const k = transform.k ?? 1;
      const hitRadius = (8 * scale) / Math.pow(k, 0.75);
      const hitRadiusSq = hitRadius * hitRadius;

      let closestId: string | null = null;
      let closestDistSq = hitRadiusSq;

      for (const p of projectedRef.current) {
        const dx = p.x - svgPt.x;
        const dy = p.y - svgPt.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestId = p.id;
        }
      }

      if (closestId) {
        event.stopPropagation();
        onClickRef.current(closestId);
      }
    },
    [projection, transform, scale],
  );

  return <g ref={groupRef} onClick={handleClick} />;
}

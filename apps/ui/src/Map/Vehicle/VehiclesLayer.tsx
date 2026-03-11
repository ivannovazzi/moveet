import { useEffect, useRef, useCallback } from "react";
import { select } from "d3";
import type { Fleet, Position } from "@/types";
import { useMapContext } from "../../components/Map/hooks";
import { vehicleStore } from "../../hooks/vehicleStore";

// Arrow shape vertices (same as original VehicleMarker polygon)
const AX = [0, 2.5, 0, -2.5];
const AY = [-4, 3, 1.5, 3];

interface VehiclesLayerProps {
  scale: number;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
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
 * Batched SVG path renderer that bypasses React for position updates.
 *
 * Reads directly from vehicleStore on each animation frame.
 * React never re-renders for vehicle position changes.
 * ~10 DOM elements total regardless of vehicle count.
 */
export default function VehiclesLayer({
  scale,
  vehicleFleetMap,
  hiddenFleetIds,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const groupRef = useRef<SVGGElement>(null);
  const { projection, transform } = useMapContext();
  const projectedRef = useRef<ProjectedVehicle[]>([]);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Refs for values that change but shouldn't restart the RAF loop
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;

  const projectPosition = useCallback(
    (pos: Position): [number, number] | null => {
      if (!projection) return null;
      const result = projection(pos);
      if (!result || !isFinite(result[0]) || !isFinite(result[1])) return null;
      return result as [number, number];
    },
    [projection],
  );

  // Core render loop: reads from vehicleStore directly, no React state
  useEffect(() => {
    if (!projection) return;

    let rafId: number;
    let lastVersion = -1;
    let lastTransformK = -1;
    let lastSelectedId: string | undefined;
    let lastHoveredId: string | undefined;

    const render = () => {
      rafId = requestAnimationFrame(render);

      const g = groupRef.current;
      if (!g) return;

      const currentVersion = vehicleStore.getVersion();
      const t = transformRef.current;
      const k = t?.k ?? 1;
      const currentSelectedId = selectedRef.current;
      const currentHoveredId = hoveredRef.current;

      // Skip if nothing changed
      const positionsChanged = currentVersion !== lastVersion;
      const zoomChanged = k !== lastTransformK;
      const selectionChanged =
        currentSelectedId !== lastSelectedId || currentHoveredId !== lastHoveredId;

      if (!positionsChanged && !zoomChanged && !selectionChanged) return;

      lastVersion = currentVersion;
      lastTransformK = k;
      lastSelectedId = currentSelectedId;
      lastHoveredId = currentHoveredId;

      const s = scale / Math.pow(k, 0.75);
      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;

      // Group vehicles by fill color, build path strings
      const colorGroups = new (globalThis.Map)<string, string>();
      const projected: ProjectedVehicle[] = [];
      let selectedPath = "";
      let hoveredPath = "";

      for (const [, v] of store) {
        // Skip vehicles at origin or in hidden fleets
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        // Position is [lat, lng] from DTO, projection expects [lng, lat]
        const pos = projectPosition([v.position[1], v.position[0]]);
        if (!pos) continue;

        const [x, y] = pos;
        projected.push({ id: v.id, x, y });

        // Build arrow path
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

        if (v.id === currentSelectedId) {
          selectedPath += d;
        } else if (v.id === currentHoveredId) {
          hoveredPath += d;
        } else {
          const color = fleet?.color ?? "var(--color-vehicle-fill)";
          const existing = colorGroups.get(color);
          colorGroups.set(color, existing ? existing + d : d);
        }
      }

      projectedRef.current = projected;

      // Render: one <path> per color group
      const container = select(g);
      const entries = Array.from(colorGroups.entries());
      const paths = container
        .selectAll<SVGPathElement, [string, string]>("path.fleet")
        .data(entries, (d) => d[0]);

      paths.exit().remove();
      paths
        .enter()
        .append("path")
        .attr("class", "fleet")
        .attr("stroke", "var(--color-vehicle-stroke)")
        .attr("stroke-width", 0.5)
        .merge(paths)
        .attr("d", (d) => d[1])
        .attr("fill", (d) => d[0]);

      // Selected vehicle
      let selPath = container.select<SVGPathElement>("path.selected");
      if (selectedPath) {
        if (selPath.empty()) {
          selPath = container
            .append("path")
            .attr("class", "selected")
            .attr("stroke", "var(--color-vehicle-selected-stroke)")
            .attr("stroke-width", 0.8)
            .attr("filter", "drop-shadow(0 0 4px var(--color-vehicle-selected-stroke))");
        }
        const selFleet = fleetMap.get(currentSelectedId!);
        selPath.attr("d", selectedPath).attr("fill", selFleet?.color ?? "var(--color-vehicle-fill)");
      } else {
        selPath.remove();
      }

      // Selection ring
      let ring = container.select<SVGCircleElement>("circle.ring");
      if (currentSelectedId) {
        const selV = projected.find((p) => p.id === currentSelectedId);
        if (selV) {
          if (ring.empty()) {
            ring = container
              .append("circle")
              .attr("class", "ring")
              .attr("fill", "var(--color-vehicle-selected-bg)")
              .attr("stroke", "var(--color-vehicle-selected-stroke)")
              .attr("stroke-width", 0.4 * s);
          }
          ring.attr("cx", selV.x).attr("cy", selV.y).attr("r", 6 * s);
        }
      } else {
        ring.remove();
      }

      // Hovered vehicle
      let hovPath = container.select<SVGPathElement>("path.hovered");
      if (hoveredPath) {
        if (hovPath.empty()) {
          hovPath = container
            .append("path")
            .attr("class", "hovered")
            .attr("stroke", "var(--color-vehicle-hover-stroke)")
            .attr("stroke-width", 0.8)
            .attr("filter", "drop-shadow(0 0 3px var(--color-vehicle-hover-stroke))");
        }
        const hovFleet = fleetMap.get(currentHoveredId!);
        hovPath.attr("d", hoveredPath).attr("fill", hovFleet?.color ?? "var(--color-vehicle-fill)");
      } else {
        hovPath.remove();
      }
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [projection, scale, projectPosition]);

  // Hit testing for clicks
  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      if (!projection || !transformRef.current) return;
      const g = groupRef.current;
      if (!g) return;

      const svg = g.ownerSVGElement;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const ctm = g.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());

      const k = transformRef.current.k ?? 1;
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
    [projection, scale],
  );

  return <g ref={groupRef} onClick={handleClick} />;
}

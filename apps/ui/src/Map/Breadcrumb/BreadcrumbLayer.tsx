import { useEffect, useRef, useCallback } from "react";
import type { Fleet, Position } from "@/types";
import { useMapContext } from "@/components/Map/hooks";
import { vehicleStore } from "@/hooks/vehicleStore";

const DEFAULT_TRAIL_COLOR = "#39f";

interface BreadcrumbLayerProps {
  selectedId?: string;
  showAll: boolean;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
}

/**
 * SVG-based layer that renders vehicle position trails as polyline segments
 * with an opacity gradient (newest = 1.0, oldest = 0.05).
 *
 * Reads directly from vehicleStore on every animation frame (fast path).
 */
export default function BreadcrumbLayer({
  selectedId,
  showAll,
  vehicleFleetMap,
  hiddenFleetIds,
}: BreadcrumbLayerProps) {
  const { projection, transform, map } = useMapContext();
  const gRef = useRef<SVGGElement | null>(null);

  // Keep mutable refs for values that change frequently
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const showAllRef = useRef(showAll);
  showAllRef.current = showAll;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const projectPosition = useCallback(
    (pos: Position): [number, number] | null => {
      if (!projection) return null;
      // Positions in store are [lat, lng]; projection expects [lng, lat]
      const result = projection([pos[1], pos[0]]);
      if (!result || !isFinite(result[0]) || !isFinite(result[1])) return null;
      return result as [number, number];
    },
    [projection]
  );

  useEffect(() => {
    if (!projection || !map) return;

    // Create the SVG <g> element inside the markers group (which receives the zoom transform)
    const markersGroup = map.querySelector("g.markers");
    if (!markersGroup) return;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-layer", "breadcrumbs");
    markersGroup.appendChild(g);
    gRef.current = g;

    let rafId: number;
    let lastVersion = -1;
    let lastTransformK = -1;
    let lastTransformX = NaN;
    let lastTransformY = NaN;
    let lastSelectedId: string | undefined;

    const render = () => {
      rafId = requestAnimationFrame(render);

      const currentVersion = vehicleStore.getVersion();
      const t = transformRef.current;
      const k = t?.k ?? 1;
      const tx = t?.x ?? 0;
      const ty = t?.y ?? 0;
      const currentSelectedId = selectedRef.current;

      const positionsChanged = currentVersion !== lastVersion;
      const zoomChanged = k !== lastTransformK || tx !== lastTransformX || ty !== lastTransformY;
      const selectionChanged = currentSelectedId !== lastSelectedId;

      if (!positionsChanged && !zoomChanged && !selectionChanged) return;

      lastVersion = currentVersion;
      lastTransformK = k;
      lastTransformX = tx;
      lastTransformY = ty;
      lastSelectedId = currentSelectedId;

      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;
      const allTrails = vehicleStore.getAllTrails();
      const showAllNow = showAllRef.current;
      const strokeWidth = 2 / k;

      // Clear previous content
      g.textContent = "";

      for (const [vehicleId, trail] of allTrails) {
        if (trail.length < 2) continue;

        // Only render for selected vehicle unless showAll
        if (!showAllNow && vehicleId !== currentSelectedId) continue;

        // Respect hidden fleets
        const fleet = fleetMap.get(vehicleId);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        const color = fleet?.color ?? DEFAULT_TRAIL_COLOR;

        // Project all positions
        const projected: [number, number][] = [];
        for (const pos of trail) {
          const p = projectPosition(pos);
          if (p) projected.push(p);
        }
        if (projected.length < 2) continue;

        // Render as individual line segments with graduated opacity
        const segmentCount = projected.length - 1;
        for (let i = 0; i < segmentCount; i++) {
          // Opacity: oldest (i=0) → 0.05, newest (i=segmentCount-1) → 1.0
          const t = segmentCount === 1 ? 1 : i / (segmentCount - 1);
          const opacity = 0.05 + t * 0.95;

          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", String(projected[i][0]));
          line.setAttribute("y1", String(projected[i][1]));
          line.setAttribute("x2", String(projected[i + 1][0]));
          line.setAttribute("y2", String(projected[i + 1][1]));
          line.setAttribute("stroke", color);
          line.setAttribute("stroke-opacity", String(opacity));
          line.setAttribute("stroke-width", String(strokeWidth));
          line.setAttribute("stroke-linecap", "round");
          g.appendChild(line);
        }
      }
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      g.remove();
      gRef.current = null;
    };
  }, [projection, map, projectPosition]);

  // This component renders nothing into React's tree — SVG is managed via DOM
  return null;
}

import { useEffect, useRef, useState, useMemo } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

const DEFAULT_TRAIL_COLOR = "#39f";

interface BreadcrumbLayerProps {
  selectedId?: string;
  showAll: boolean;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
}

/** Trail data fed to deck.gl PathLayer. */
interface TrailData {
  vehicleId: string;
  path: [number, number][]; // [lng, lat] pairs
  color: [number, number, number, number]; // RGBA
}

/** Convert hex color string to RGBA tuple. */
function hexToRgba(hex: string, alpha = 180): [number, number, number, number] {
  const h = hex.replace("#", "");
  const bigint =
    h.length === 3 ? parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16) : parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b, alpha];
}

/**
 * deck.gl PathLayer-based breadcrumb trail renderer.
 *
 * Preserves the RAF loop that reads directly from vehicleStore,
 * but delegates rendering to deck.gl instead of SVG DOM manipulation.
 */
export default function BreadcrumbLayer({
  selectedId,
  showAll,
  vehicleFleetMap,
  hiddenFleetIds,
}: BreadcrumbLayerProps) {
  const [trailData, setTrailData] = useState<TrailData[]>([]);

  // Refs for values that change frequently but shouldn't restart the RAF loop
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const showAllRef = useRef(showAll);
  showAllRef.current = showAll;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;

  // RAF loop: reads from vehicleStore, updates React state for deck.gl
  // Throttled to avoid overwhelming React with state updates
  useEffect(() => {
    let rafId: number;
    let lastVersion = -1;
    let lastSelectedId: string | undefined;
    let lastSetStateTime = 0;
    const STATE_UPDATE_INTERVAL = 100; // trails don't need 60fps updates

    const render = () => {
      rafId = requestAnimationFrame(render);

      const currentVersion = vehicleStore.getVersion();
      const currentSelectedId = selectedRef.current;

      const positionsChanged = currentVersion !== lastVersion;
      const selectionChanged = currentSelectedId !== lastSelectedId;

      if (!positionsChanged && !selectionChanged) return;

      const now = performance.now();
      if (!selectionChanged && now - lastSetStateTime < STATE_UPDATE_INTERVAL) return;
      lastSetStateTime = now;

      lastVersion = currentVersion;
      lastSelectedId = currentSelectedId;

      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;
      const allTrails = vehicleStore.getAllTrails();
      const showAllNow = showAllRef.current;

      const trails: TrailData[] = [];

      for (const [vehicleId, trail] of allTrails) {
        if (trail.length < 2) continue;

        // Only render for selected vehicle unless showAll
        if (!showAllNow && vehicleId !== currentSelectedId) continue;

        // Respect hidden fleets
        const fleet = fleetMap.get(vehicleId);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        const colorHex = fleet?.color ?? DEFAULT_TRAIL_COLOR;
        // Use slight transparency (alpha=180) for the whole trail
        const color = hexToRgba(colorHex, 180);

        // Convert trail positions from [lat, lng] to [lng, lat] for deck.gl
        const path: [number, number][] = [];
        for (const pos of trail) {
          path.push([pos[1], pos[0]]);
        }
        if (path.length < 2) continue;

        trails.push({ vehicleId, path, color });
      }

      setTrailData(trails);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Build deck.gl PathLayer
  const layers = useMemo(() => {
    return [
      new PathLayer<TrailData>({
        id: "breadcrumbs",
        data: trailData,
        getPath: (d) => d.path,
        getColor: (d) => d.color,
        getWidth: 2,
        widthUnits: "pixels",
        widthMinPixels: 1,
        pickable: false,
        _pathType: "open",
      }),
    ];
  }, [trailData]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("breadcrumbs", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}

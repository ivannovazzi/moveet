import { useEffect, useRef, useState, useMemo } from "react";
import { PathLayer } from "@deck.gl/layers";
import type { Fleet } from "@/types";
import { vehicleStore } from "@/hooks/vehicleStore";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";

interface BreadcrumbLayerProps {
  selectedId?: string;
  showAll: boolean;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
}

/** Trail data fed to deck.gl PathLayer. */
interface TrailData {
  vehicleId: string;
  path: [number, number][]; // [lng, lat] pairs, oldest → newest
  /** Per-vertex color (PathLayer supports Color[] for a gradient along the
   * path) — alpha fades from oldest to newest point for a recency cue. */
  color: [number, number, number, number][];
}

/** Convert hex color string to an [r,g,b] triple (alpha applied separately). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const bigint =
    h.length === 3 ? parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16) : parseInt(h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// Trail alpha fades linearly from the newest point (full) to the oldest
// (dimmed, not fully transparent so a long-idle trail is still legible).
const TRAIL_ALPHA_NEWEST = 200;
const TRAIL_ALPHA_OLDEST = 40;

// The fade ramp depends only on a trail's length (position-in-trail), not on
// its color, so it's identical across every vehicle that currently has that
// length — cached here instead of re-deriving it with Math.round() per point
// per vehicle on every ~10fps trail tick.
const alphaRampCache = new Map<number, number[]>();
function alphaRampForLength(length: number): number[] {
  const cached = alphaRampCache.get(length);
  if (cached) return cached;
  const lastIdx = length - 1;
  const ramp = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const age = lastIdx === 0 ? 0 : i / lastIdx; // 0 = oldest, 1 = newest
    ramp[i] = Math.round(TRAIL_ALPHA_OLDEST + (TRAIL_ALPHA_NEWEST - TRAIL_ALPHA_OLDEST) * age);
  }
  alphaRampCache.set(length, ramp);
  return ramp;
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

        const [r, g, b] = fleet?.color
          ? hexToRgb(fleet.color)
          : resolveMapColor("var(--color-overlay-trail)");

        // Convert trail positions from [lat, lng] to [lng, lat] for deck.gl,
        // fading alpha from oldest (dim) to newest (full) point.
        const path: [number, number][] = [];
        const color: [number, number, number, number][] = [];
        const alphaRamp = alphaRampForLength(trail.length);
        for (let i = 0; i < trail.length; i++) {
          const pos = trail[i];
          path.push([pos[1], pos[0]]);
          color.push([r, g, b, alphaRamp[i]]);
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
      }),
    ];
  }, [trailData]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("breadcrumbs", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}

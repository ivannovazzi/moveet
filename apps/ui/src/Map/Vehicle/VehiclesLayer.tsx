import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Fleet } from "@/types";
import { vehicleStore } from "../../hooks/vehicleStore";
import { VEHICLE_INTERPOLATION } from "../../data/constants";
import { useRegisterLayers } from "../../components/Map/hooks/useDeckLayers";

// Vehicle type → shape definitions (preserved for future polygon vehicle shapes)
const VEHICLE_SHAPES: Record<string, { x: number[]; y: number[] }> = {
  car: { x: [0, 2.5, 0, -2.5], y: [-4, 3, 1.5, 3] },
  truck: { x: [0, 3, 3, -3, -3], y: [-5, -1, 4, 4, -1] },
  motorcycle: { x: [0, 1.5, 0, -1.5], y: [-5, 2, 0, 2] },
  ambulance: {
    x: [0, 2, 2, 0.8, 0.8, 2, 2, 0, -2, -2, -0.8, -0.8, -2, -2],
    y: [-4, -4, -0.8, -0.8, 0.8, 0.8, 4, 4, 4, 0.8, 0.8, -0.8, -0.8, -4],
  },
  bus: { x: [0, 3.5, 3.5, -3.5, -3.5], y: [-5, -2, 5, 5, -2] },
};

// Type-specific default colors (used when no fleet color)
const VEHICLE_TYPE_COLORS: Record<string, string> = {
  car: "#dcdcdc",
  truck: "#f59e0b",
  motorcycle: "#8b5cf6",
  ambulance: "#ef4444",
  bus: "#3b82f6",
};

const DEFAULT_FILL = "#dcdcdc";
const SELECTED_STROKE: [number, number, number, number] = [0, 102, 204, 255];
const SELECTED_BG: [number, number, number, number] = [33, 255, 205, 77];
const HOVER_STROKE: [number, number, number, number] = [251, 201, 1, 255];
const DEFAULT_STROKE: [number, number, number, number] = [0, 0, 0, 128];

// Keep shape constants exported for potential future use
void VEHICLE_SHAPES;

interface VehiclesLayerProps {
  scale: number;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/** Interpolated vehicle data fed to deck.gl layers. */
interface InterpolatedVehicle {
  id: string;
  position: [number, number]; // [lng, lat] for deck.gl
  heading: number;
  color: [number, number, number, number]; // RGBA
  type: string;
  isSelected: boolean;
  isHovered: boolean;
}

/** Per-vehicle interpolation state for smooth animation between WS updates. */
interface VehicleInterp {
  prevLat: number;
  prevLng: number;
  prevHeading: number;
  nextLat: number;
  nextLng: number;
  nextHeading: number;
  updateTime: number;
  /** Per-vehicle lerp duration measured via EMA. */
  lerpMs: number;
}

const { DEFAULT_LERP_MS, MIN_LERP_MS, MAX_T } = VEHICLE_INTERPOLATION;

/** Lerp a single value from a to b by t in [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-arc lerp for angles in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

/**
 * Resolve a CSS variable reference like "var(--color-vehicle-fill)" to its
 * computed value, or return the input unchanged if it's already a plain color.
 */
function resolveCSSColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const match = color.match(/^var\(([^)]+)\)$/);
  if (!match) return DEFAULT_FILL;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || DEFAULT_FILL;
}

/** Convert hex color string to RGBA tuple for deck.gl. */
function hexToRgba(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace("#", "");
  const bigint =
    h.length === 3 ? parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16) : parseInt(h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b, alpha];
}

/** Convert a color string (hex or CSS variable) to RGBA tuple. */
function colorToRgba(color: string, alpha = 255): [number, number, number, number] {
  const resolved = resolveCSSColor(color);
  if (resolved.startsWith("#")) return hexToRgba(resolved, alpha);
  // Fallback for rgb/rgba strings — extract numbers
  const nums = resolved.match(/\d+/g);
  if (nums && nums.length >= 3) {
    return [
      parseInt(nums[0]),
      parseInt(nums[1]),
      parseInt(nums[2]),
      nums.length >= 4 ? Math.round(parseFloat(nums[3]) * 255) : alpha,
    ];
  }
  return hexToRgba(DEFAULT_FILL, alpha);
}

/**
 * deck.gl-based vehicle renderer.
 *
 * Preserves the RAF interpolation loop from the Canvas version:
 * reads directly from vehicleStore on each animation frame,
 * applies per-vehicle EMA-based lerp, and feeds interpolated
 * positions to ScatterplotLayer via React state.
 *
 * deck.gl handles rendering and hit testing (pickable layers).
 */
export default function VehiclesLayer({
  scale: _scale,
  vehicleFleetMap,
  hiddenFleetIds,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const [interpolatedVehicles, setInterpolatedVehicles] = useState<InterpolatedVehicle[]>([]);
  const interpRef = useRef(new Map<string, VehicleInterp>());

  // Refs for values that change but shouldn't restart the RAF loop
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const fleetMapRef = useRef(vehicleFleetMap);
  fleetMapRef.current = vehicleFleetMap;
  const hiddenFleetsRef = useRef(hiddenFleetIds);
  hiddenFleetsRef.current = hiddenFleetIds;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // RAF interpolation loop: reads from vehicleStore, updates React state
  useEffect(() => {
    let rafId: number;
    let lastVersion = -1;
    let animating = false;

    const render = () => {
      rafId = requestAnimationFrame(render);

      const currentVersion = vehicleStore.getVersion();
      const currentSelectedId = selectedRef.current;
      const currentHoveredId = hoveredRef.current;
      const now = performance.now();

      const positionsChanged = currentVersion !== lastVersion;

      // Update interpolation targets when new data arrives
      if (positionsChanged) {
        lastVersion = currentVersion;

        const store = vehicleStore.getAll();
        const interps = interpRef.current;

        for (const [id, v] of store) {
          const existing = interps.get(id);
          const lat = v.position[0];
          const lng = v.position[1];
          const heading = ((v.heading ?? 0) * Math.PI) / 180;

          if (existing) {
            const posChanged = lat !== existing.nextLat || lng !== existing.nextLng;
            if (!posChanged) continue;

            // Update per-vehicle lerp duration via EMA (alpha = 0.3)
            const elapsed = now - existing.updateTime;
            if (elapsed > MIN_LERP_MS) {
              existing.lerpMs =
                existing.lerpMs === DEFAULT_LERP_MS
                  ? elapsed
                  : existing.lerpMs * 0.7 + elapsed * 0.3;
            }

            // Snap prev to wherever we currently are in the lerp (avoid jump-back)
            const snapT = Math.min((now - existing.updateTime) / existing.lerpMs, 1);
            existing.prevLat = lerp(existing.prevLat, existing.nextLat, snapT);
            existing.prevLng = lerp(existing.prevLng, existing.nextLng, snapT);
            existing.prevHeading = lerpAngle(existing.prevHeading, existing.nextHeading, snapT);
            existing.nextLat = lat;
            existing.nextLng = lng;
            existing.nextHeading = heading;
            existing.updateTime = now;
          } else {
            interps.set(id, {
              prevLat: lat,
              prevLng: lng,
              prevHeading: heading,
              nextLat: lat,
              nextLng: lng,
              nextHeading: heading,
              updateTime: now,
              lerpMs: DEFAULT_LERP_MS,
            });
          }
        }

        // Remove stale vehicles
        for (const id of interps.keys()) {
          if (!store.has(id)) interps.delete(id);
        }
      }

      // Determine if any vehicle is still mid-interpolation
      animating = false;
      const interps = interpRef.current;
      for (const state of interps.values()) {
        if (now - state.updateTime < state.lerpMs * MAX_T) {
          animating = true;
          break;
        }
      }

      // Skip update only if nothing changed AND no animation in progress
      if (!positionsChanged && !animating) return;

      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;

      const vehicles: InterpolatedVehicle[] = [];

      for (const [, v] of store) {
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        // Interpolate position from stored state
        const state = interps.get(v.id);
        let lat: number, lng: number, heading: number;

        if (state) {
          const elapsed = now - state.updateTime;
          const t01 = Math.min(elapsed / state.lerpMs, MAX_T);
          lat = lerp(state.prevLat, state.nextLat, t01);
          lng = lerp(state.prevLng, state.nextLng, t01);
          heading = lerpAngle(state.prevHeading, state.nextHeading, Math.min(t01, 1));
        } else {
          lat = v.position[0];
          lng = v.position[1];
          heading = ((v.heading ?? 0) * Math.PI) / 180;
        }

        const vehicleType = v.type || "car";
        const defaultColor = VEHICLE_TYPE_COLORS[vehicleType] || DEFAULT_FILL;
        const fillColor = colorToRgba(fleet?.color ?? defaultColor);

        vehicles.push({
          id: v.id,
          position: [lng, lat], // deck.gl expects [lng, lat]
          heading,
          color: fillColor,
          type: vehicleType,
          isSelected: v.id === currentSelectedId,
          isHovered: v.id === currentHoveredId,
        });
      }

      setInterpolatedVehicles(vehicles);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Stable click handler
  const handleClick = useCallback((info: { object?: InterpolatedVehicle }) => {
    if (info.object) {
      onClickRef.current(info.object.id);
    }
  }, []);

  // Build the selected vehicle data for the selection ring layer
  const selectedVehicle = useMemo(() => {
    if (!selectedId) return [];
    const found = interpolatedVehicles.find((v) => v.id === selectedId);
    return found ? [found] : [];
  }, [interpolatedVehicles, selectedId]);

  // Build deck.gl layers
  const layers = useMemo(() => {
    const vehiclesLayer = new ScatterplotLayer<InterpolatedVehicle>({
      id: "vehicles",
      data: interpolatedVehicles,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getLineColor: (d) =>
        d.isSelected ? SELECTED_STROKE : d.isHovered ? HOVER_STROKE : DEFAULT_STROKE,
      getRadius: 6,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      radiusMaxPixels: 12,
      lineWidthMinPixels: 1,
      stroked: true,
      pickable: true,
      onClick: handleClick,
      autoHighlight: true,
      highlightColor: [251, 201, 1, 80],
      updateTriggers: {
        getFillColor: [selectedId, hoveredId],
        getLineColor: [selectedId, hoveredId],
      },
    });

    const selectionRingLayer = new ScatterplotLayer<InterpolatedVehicle>({
      id: "vehicle-selection-ring",
      data: selectedVehicle,
      getPosition: (d) => d.position,
      getFillColor: SELECTED_BG,
      getLineColor: SELECTED_STROKE,
      getRadius: 12,
      radiusUnits: "pixels",
      stroked: true,
      lineWidthMinPixels: 2,
      pickable: false,
    });

    return [selectionRingLayer, vehiclesLayer];
  }, [interpolatedVehicles, selectedId, hoveredId, selectedVehicle, handleClick]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("vehicles", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}

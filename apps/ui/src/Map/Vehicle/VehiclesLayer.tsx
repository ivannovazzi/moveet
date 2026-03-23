import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Fleet, VehicleType } from "@/types";
import { vehicleStore } from "../../hooks/vehicleStore";
import { VEHICLE_INTERPOLATION } from "../../data/constants";
import { useRegisterLayers } from "../../components/Map/hooks/useDeckLayers";
import { useMapContext } from "../../components/Map/hooks";

// Vehicle type → shape definitions as polygon vertices (pixel-space units)
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

/** Each shape unit maps to this many meters in world space. */
const METERS_PER_SHAPE_UNIT = 5;
/** Degrees of latitude per meter (constant everywhere on earth). */
const DEG_PER_METER_LAT = 1 / 110540;

/**
 * Convert a shape definition into a polygon of [lng, lat] vertices,
 * rotated by the vehicle heading and offset to the vehicle position.
 */
function shapeToPolygon(
  lng: number,
  lat: number,
  heading: number,
  shape: { x: number[]; y: number[] },
  scale: number
): [number, number][] {
  const cosH = Math.cos(heading);
  const sinH = Math.sin(heading);
  const degPerMeterLng = 1 / (111320 * Math.cos(lat * (Math.PI / 180)));
  const s = METERS_PER_SHAPE_UNIT * scale;

  return shape.x.map((sx, i) => {
    const sy = shape.y[i];
    // Rotate vertex by compass bearing (0 = north, clockwise positive)
    // Shape front is at -Y, geographic north is +Y, so negate ry.
    const rx = sx * cosH - sy * sinH;
    const ry = -(sx * sinH + sy * cosH);
    // Convert to degree offsets and add to vehicle position
    return [lng + rx * s * degPerMeterLng, lat + ry * s * DEG_PER_METER_LAT] as [number, number];
  });
}

interface VehiclesLayerProps {
  scale: number;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
  selectedId?: string;
  hoveredId?: string;
  onClick: (id: string) => void;
}

/** Interpolated vehicle data with precomputed polygon for deck.gl PolygonLayer. */
interface VehiclePolygonDatum {
  id: string;
  position: [number, number]; // [lng, lat]
  polygon: [number, number][]; // rotated shape vertices in [lng, lat]
  color: [number, number, number, number]; // RGBA fill
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
 * Results are cached to avoid getComputedStyle on every frame.
 */
const cssColorCache = new Map<string, string>();
function resolveCSSColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const cached = cssColorCache.get(color);
  if (cached) return cached;
  const match = color.match(/^var\(([^)]+)\)$/);
  if (!match) return DEFAULT_FILL;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  const resolved = value || DEFAULT_FILL;
  cssColorCache.set(color, resolved);
  return resolved;
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

const DEFAULT_SHAPE = VEHICLE_SHAPES.car;

/**
 * deck.gl-based vehicle renderer with polygon shapes.
 *
 * Preserves the RAF interpolation loop from the Canvas version:
 * reads directly from vehicleStore on each animation frame,
 * applies per-vehicle EMA-based lerp, and feeds interpolated
 * positions + rotated polygon vertices to PolygonLayer via React state.
 *
 * Each vehicle type (car, truck, bus, etc.) renders as its original
 * polygon shape, rotated by the vehicle heading.
 */
/**
 * Zoom-dependent vehicle scaling. Vehicles grow when zooming in and shrink
 * when zooming out, but at a reduced rate (exponent < 1) so they remain
 * visible at overview zoom levels instead of becoming sub-pixel.
 *
 * At REFERENCE_ZOOM the scale is 1 (true geographic size ~25m).
 * The exponent controls how aggressively they scale: 1.0 = pure geographic,
 * 0.0 = constant pixel size. 0.6 is a good middle ground.
 */
const REFERENCE_ZOOM = 16;
const ZOOM_EXPONENT = 0.6;

export default function VehiclesLayer({
  scale: _scale,
  vehicleFleetMap,
  hiddenFleetIds,
  hiddenVehicleTypes,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const { getZoom } = useMapContext();
  const [vehiclePolygons, setVehiclePolygons] = useState<VehiclePolygonDatum[]>([]);
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
  const hiddenTypesRef = useRef(hiddenVehicleTypes);
  hiddenTypesRef.current = hiddenVehicleTypes;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const getZoomRef = useRef(getZoom);
  getZoomRef.current = getZoom;

  // RAF interpolation loop: reads from vehicleStore, updates React state
  // Throttled to ~30fps to avoid overwhelming React with state updates
  useEffect(() => {
    let rafId: number;
    let lastVersion = -1;
    let lastZoom = -1;
    let animating = false;
    let lastSetStateTime = 0;
    const STATE_UPDATE_INTERVAL = 33; // ~30fps for React state updates

    const render = () => {
      rafId = requestAnimationFrame(render);

      const currentVersion = vehicleStore.getVersion();
      const currentSelectedId = selectedRef.current;
      const currentHoveredId = hoveredRef.current;
      const now = performance.now();
      const currentZoom = getZoomRef.current();

      const positionsChanged = currentVersion !== lastVersion;
      const zoomChanged = Math.abs(currentZoom - lastZoom) > 0.01;

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
      if (!positionsChanged && !animating && !zoomChanged) return;
      if (zoomChanged) lastZoom = currentZoom;

      // Throttle React state updates to avoid 60fps re-renders
      if (now - lastSetStateTime < STATE_UPDATE_INTERVAL) return;
      lastSetStateTime = now;

      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;
      const hiddenTypes = hiddenTypesRef.current;
      // Scale = 2^((REF_ZOOM - zoom) * exponent). At REF_ZOOM scale=1 (true size).
      // Exponent < 1 makes vehicles shrink slower than map when zooming out.
      const zoomScale = Math.pow(2, (REFERENCE_ZOOM - currentZoom) * ZOOM_EXPONENT);

      const vehicles: VehiclePolygonDatum[] = [];

      for (const [, v] of store) {
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;
        if (hiddenTypes.size > 0 && hiddenTypes.has((v.type as VehicleType) || "car")) continue;

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
        const shape = VEHICLE_SHAPES[vehicleType] || DEFAULT_SHAPE;

        vehicles.push({
          id: v.id,
          position: [lng, lat], // deck.gl expects [lng, lat]
          polygon: shapeToPolygon(lng, lat, heading, shape, zoomScale),
          color: fillColor,
          isSelected: v.id === currentSelectedId,
          isHovered: v.id === currentHoveredId,
        });
      }

      setVehiclePolygons(vehicles);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Stable click handler
  const handleClick = useCallback((info: { object?: VehiclePolygonDatum }) => {
    if (info.object) {
      onClickRef.current(info.object.id);
    }
  }, []);

  // Build the selected vehicle data for the selection ring layer
  const selectedVehicle = useMemo(() => {
    if (!selectedId) return [];
    const found = vehiclePolygons.find((v) => v.id === selectedId);
    return found ? [found] : [];
  }, [vehiclePolygons, selectedId]);

  // Build deck.gl layers
  const layers = useMemo(() => {
    const vehiclesLayer = new PolygonLayer<VehiclePolygonDatum>({
      id: "vehicles",
      data: vehiclePolygons,
      getPolygon: (d) => d.polygon,
      getFillColor: (d) => d.color,
      getLineColor: (d) =>
        d.isSelected ? SELECTED_STROKE : d.isHovered ? HOVER_STROKE : DEFAULT_STROKE,
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      filled: true,
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

    const selectionRingLayer = new ScatterplotLayer<VehiclePolygonDatum>({
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
  }, [vehiclePolygons, selectedId, hoveredId, selectedVehicle, handleClick]);

  // Register layers with the DeckGLMap parent
  useRegisterLayers("vehicles", layers);

  // Render nothing — layers are registered via useRegisterLayers
  return null;
}

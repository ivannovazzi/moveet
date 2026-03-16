import { useEffect, useRef, useCallback } from "react";
import type { Fleet, Position } from "@/types";
import { toMapPosition } from "@/utils/coordinates";
import { useMapContext } from "../../components/Map/hooks";
import { vehicleStore } from "../../hooks/vehicleStore";
import { VEHICLE_RENDER, VEHICLE_INTERPOLATION } from "../../data/constants";

// Arrow shape vertices (same as original VehicleMarker polygon)
const AX = [0, 2.5, 0, -2.5];
const AY = [-4, 3, 1.5, 3];

// Vehicle type → shape definitions (polygon points as [x,y] arrays, normalized)
const VEHICLE_SHAPES: Record<string, { x: number[]; y: number[] }> = {
  car:         { x: AX,                                                          y: AY },
  truck:       { x: [0, 3, 3, -3, -3],                                          y: [-5, -1, 4, 4, -1] },
  motorcycle:  { x: [0, 1.5, 0, -1.5],                                          y: [-5, 2, 0, 2] },
  ambulance:   { x: [0, 2, 2, 0.8, 0.8, 2, 2, 0, -2, -2, -0.8, -0.8, -2, -2],
                 y: [-4, -4, -0.8, -0.8, 0.8, 0.8, 4, 4, 4, 0.8, 0.8, -0.8, -0.8, -4] },
  bus:         { x: [0, 3.5, 3.5, -3.5, -3.5],                                  y: [-5, -2, 5, 5, -2] },
};

// Type-specific default colors (used when no fleet color)
const VEHICLE_TYPE_COLORS: Record<string, string> = {
  car: "#dcdcdc",
  truck: "#f59e0b",
  motorcycle: "#8b5cf6",
  ambulance: "#ef4444",
  bus: "#3b82f6",
};

/** Default fallback colors matching CSS variables in tokens.css */
const DEFAULT_FILL = "#dcdcdc";
const DEFAULT_STROKE = "rgba(0,0,0,0.5)";
const SELECTED_STROKE = "#06c";
const SELECTED_BG = "rgba(33, 255, 205, 0.3)";
const HOVER_STROKE = "rgb(251, 201, 1)";

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

/** Lerp a single value from a to b by t ∈ [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-arc lerp for angles in radians. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // Normalize to [-PI, PI]
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

/**
 * Draw a vehicle shape on a 2D canvas context based on vehicle type.
 */
function drawShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  s: number,
  vehicleType: string,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number
) {
  const shape = VEHICLE_SHAPES[vehicleType] || VEHICLE_SHAPES.car;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(shape.x[0] * s, shape.y[0] * s);
  for (let i = 1; i < shape.x.length; i++) {
    ctx.lineTo(shape.x[i] * s, shape.y[i] * s);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a glow effect behind a vehicle shape for selected/hovered vehicles.
 */
function drawGlowShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  s: number,
  vehicleType: string,
  fillColor: string,
  glowColor: string,
  glowRadius: number
) {
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = glowRadius;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  drawShape(ctx, x, y, heading, s, vehicleType, fillColor, glowColor, VEHICLE_RENDER.GLOW_STROKE_WIDTH);
  ctx.restore();
}

/**
 * Draw a selection ring (circle) around a vehicle.
 */
function drawSelectionRing(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, VEHICLE_RENDER.SELECTION_RING_RADIUS * s, 0, Math.PI * 2);
  ctx.fillStyle = SELECTED_BG;
  ctx.fill();
  ctx.strokeStyle = SELECTED_STROKE;
  ctx.lineWidth = VEHICLE_RENDER.SELECTION_RING_STROKE_WIDTH * s;
  ctx.stroke();
  ctx.restore();
}

/**
 * Canvas-based vehicle renderer that bypasses React for position updates.
 *
 * Reads directly from vehicleStore on each animation frame.
 * React never re-renders for vehicle position changes.
 * Uses a single HTML5 Canvas element for all vehicles instead of SVG DOM.
 */
export default function VehiclesLayer({
  scale,
  vehicleFleetMap,
  hiddenFleetIds,
  selectedId,
  hoveredId,
  onClick,
}: VehiclesLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { projection, transform, map } = useMapContext();
  const projectedRef = useRef<ProjectedVehicle[]>([]);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const containerRef = useRef<HTMLElement | null>(null);
  const interpRef = useRef(new Map<string, VehicleInterp>());

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
    [projection]
  );

  // Create and mount the canvas element into the map's container div
  useEffect(() => {
    if (!map) return;

    // The map container is the parent div with position: relative
    const container = map.parentElement;
    if (!container) return;
    containerRef.current = container;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Vehicle fleet map");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    // Size the canvas backing buffer to match the container
    let disposed = false;
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      canvas.remove();
      canvasRef.current = null;
      containerRef.current = null;
    };
  }, [map]);

  // Core render loop: reads from vehicleStore directly, no React state.
  // Interpolates vehicle positions between WS updates for smooth animation.
  useEffect(() => {
    if (!projection) return;

    let rafId: number;
    let lastVersion = -1;
    let lastTransformK = -1;
    let lastTransformX = NaN;
    let lastTransformY = NaN;
    let lastSelectedId: string | undefined;
    let lastHoveredId: string | undefined;
    let animating = false;

    const render = () => {
      rafId = requestAnimationFrame(render);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const currentVersion = vehicleStore.getVersion();
      const t = transformRef.current;
      const k = t?.k ?? 1;
      const tx = t?.x ?? 0;
      const ty = t?.y ?? 0;
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
            // Only update interp when this vehicle's position actually changed
            const posChanged = lat !== existing.nextLat || lng !== existing.nextLng;
            if (!posChanged) continue;

            // Update per-vehicle lerp duration via EMA (α = 0.3)
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

      const zoomChanged = k !== lastTransformK || tx !== lastTransformX || ty !== lastTransformY;
      const selectionChanged =
        currentSelectedId !== lastSelectedId || currentHoveredId !== lastHoveredId;

      // Skip redraw only if nothing changed AND no animation in progress
      if (!positionsChanged && !animating && !zoomChanged && !selectionChanged) return;

      lastTransformK = k;
      lastTransformX = tx;
      lastTransformY = ty;
      lastSelectedId = currentSelectedId;
      lastHoveredId = currentHoveredId;

      const dpr = window.devicePixelRatio || 1;
      const canvasW = canvas.width;
      const canvasH = canvas.height;

      // Clear the canvas
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvasW, canvasH);

      const s = scale / Math.pow(k, 0.75);
      const store = vehicleStore.getAll();
      const fleetMap = fleetMapRef.current;
      const hiddenFleets = hiddenFleetsRef.current;

      // Apply DPR scaling and D3 zoom transform
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

      // Collect vehicles for rendering
      const projected: ProjectedVehicle[] = [];

      let selectedVehicle: { x: number; y: number; heading: number; color: string; type: string } | null = null;
      let hoveredVehicle: { x: number; y: number; heading: number; color: string; type: string } | null = null;

      const colorBatches = new Map<string, Array<{ x: number; y: number; heading: number; type: string }>>();

      for (const [, v] of store) {
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        // Interpolate position from stored state
        const state = interps.get(v.id);
        let lat: number, lng: number, heading: number;

        if (state) {
          const elapsed = now - state.updateTime;
          // Allow slight extrapolation past target to prevent pause between updates
          const t01 = Math.min(elapsed / state.lerpMs, MAX_T);
          lat = lerp(state.prevLat, state.nextLat, t01);
          lng = lerp(state.prevLng, state.nextLng, t01);
          // Don't extrapolate heading past target (would continue turning)
          heading = lerpAngle(state.prevHeading, state.nextHeading, Math.min(t01, 1));
        } else {
          lat = v.position[0];
          lng = v.position[1];
          heading = ((v.heading ?? 0) * Math.PI) / 180;
        }

        // Projection expects [lng, lat] — toMapPosition swaps from [lat, lng]
        const pos = projectPosition(toMapPosition([lat, lng]));
        if (!pos) continue;

        const [x, y] = pos;
        projected.push({ id: v.id, x, y });

        if (v.id === currentSelectedId) {
          const vehicleType = v.type || "car";
          const defaultColor = VEHICLE_TYPE_COLORS[vehicleType] || DEFAULT_FILL;
          selectedVehicle = { x, y, heading, color: fleet?.color ?? defaultColor, type: vehicleType };
        } else if (v.id === currentHoveredId) {
          const vehicleType = v.type || "car";
          const defaultColor = VEHICLE_TYPE_COLORS[vehicleType] || DEFAULT_FILL;
          hoveredVehicle = { x, y, heading, color: fleet?.color ?? defaultColor, type: vehicleType };
        } else {
          const vehicleType = v.type || "car";
          const defaultColor = VEHICLE_TYPE_COLORS[vehicleType] || DEFAULT_FILL;
          const color = resolveCSSColor(fleet?.color ?? defaultColor);
          const batchKey = `${color}|${vehicleType}`;
          let batch = colorBatches.get(batchKey);
          if (!batch) {
            batch = [];
            colorBatches.set(batchKey, batch);
          }
          batch.push({ x, y, heading, type: vehicleType });
        }
      }

      projectedRef.current = projected;

      // Draw regular vehicles grouped by color and type
      for (const [key, vehicles] of colorBatches) {
        const [color, batchType] = key.split("|");

        for (const v of vehicles) {
          drawShape(ctx, v.x, v.y, v.heading, s, batchType, color, DEFAULT_STROKE, VEHICLE_RENDER.STROKE_WIDTH);
        }
      }

      if (selectedVehicle && currentSelectedId) {
        drawSelectionRing(ctx, selectedVehicle.x, selectedVehicle.y, s);
      }

      if (hoveredVehicle) {
        drawGlowShape(
          ctx,
          hoveredVehicle.x,
          hoveredVehicle.y,
          hoveredVehicle.heading,
          s,
          hoveredVehicle.type,
          resolveCSSColor(hoveredVehicle.color),
          HOVER_STROKE,
          VEHICLE_RENDER.HOVER_GLOW_RADIUS
        );
      }

      if (selectedVehicle) {
        drawGlowShape(
          ctx,
          selectedVehicle.x,
          selectedVehicle.y,
          selectedVehicle.heading,
          s,
          selectedVehicle.type,
          resolveCSSColor(selectedVehicle.color),
          SELECTED_STROKE,
          VEHICLE_RENDER.SELECTED_GLOW_RADIUS
        );
      }
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [projection, scale, projectPosition]);

  // Hit testing for clicks — listen on the SVG in capture phase
  useEffect(() => {
    if (!map || !projection) return;

    const handleClick = (event: MouseEvent) => {
      const t = transformRef.current;
      if (!t) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get click position relative to the SVG/canvas container
      const rect = canvas.getBoundingClientRect();
      const clientX = event.clientX - rect.left;
      const clientY = event.clientY - rect.top;

      // Convert screen coords to projected coords by inverting the zoom transform
      // screen = transform * projected  =>  projected = inverse(transform) * screen
      const k = t.k;
      const projX = (clientX - t.x) / k;
      const projY = (clientY - t.y) / k;

      const hitRadius = (VEHICLE_RENDER.HIT_TEST_RADIUS * scale) / Math.pow(k, 0.75);
      const hitRadiusSq = hitRadius * hitRadius;

      let closestId: string | null = null;
      let closestDistSq = hitRadiusSq;

      for (const p of projectedRef.current) {
        const dx = p.x - projX;
        const dy = p.y - projY;
        const distSq = dx * dx + dy * dy;
        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestId = p.id;
        }
      }

      if (closestId) {
        event.stopPropagation();
        event.preventDefault();
        onClickRef.current(closestId);
      }
    };

    // Use capture phase so we can intercept before the SVG's own onClick
    map.addEventListener("click", handleClick, true);
    return () => {
      map.removeEventListener("click", handleClick, true);
    };
  }, [map, projection, scale]);

  // Render nothing into the SVG — canvas is a sibling managed via DOM
  return null;
}

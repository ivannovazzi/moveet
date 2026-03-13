import { useEffect, useRef, useCallback } from "react";
import type { Fleet, Position } from "@/types";
import { useMapContext } from "../../components/Map/hooks";
import { vehicleStore } from "../../hooks/vehicleStore";

// Arrow shape vertices (same as original VehicleMarker polygon)
const AX = [0, 2.5, 0, -2.5];
const AY = [-4, 3, 1.5, 3];

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
}

/** Duration (ms) over which positions interpolate — slightly above WS flush interval. */
const LERP_DURATION_MS = 150;

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
 * Draw an arrow (vehicle marker) on a 2D canvas context.
 */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  s: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.beginPath();
  ctx.moveTo(AX[0] * s, AY[0] * s);
  ctx.lineTo(AX[1] * s, AY[1] * s);
  ctx.lineTo(AX[2] * s, AY[2] * s);
  ctx.lineTo(AX[3] * s, AY[3] * s);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a glow effect behind an arrow for selected/hovered vehicles.
 */
function drawGlowArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  s: number,
  fillColor: string,
  glowColor: string,
  glowRadius: number,
) {
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = glowRadius;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  drawArrow(ctx, x, y, heading, s, fillColor, glowColor, 0.8);
  ctx.restore();
}

/**
 * Draw a selection ring (circle) around a vehicle.
 */
function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
  ctx.fillStyle = SELECTED_BG;
  ctx.fill();
  ctx.strokeStyle = SELECTED_STROKE;
  ctx.lineWidth = 0.4 * s;
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
    [projection],
  );

  // Create and mount the canvas element into the map's container div
  useEffect(() => {
    if (!map) return;

    // The map container is the parent div with position: relative
    const container = map.parentElement;
    if (!container) return;
    containerRef.current = container;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    container.appendChild(canvas);
    canvasRef.current = canvas;

    // Size the canvas backing buffer to match the container
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
    });
    resizeObserver.observe(container);

    return () => {
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
            // Snap prev to wherever we currently are in the lerp (avoid jump-back)
            const elapsed = now - existing.updateTime;
            const t01 = Math.min(elapsed / LERP_DURATION_MS, 1);
            existing.prevLat = lerp(existing.prevLat, existing.nextLat, t01);
            existing.prevLng = lerp(existing.prevLng, existing.nextLng, t01);
            existing.prevHeading = lerpAngle(existing.prevHeading, existing.nextHeading, t01);
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
        if (now - state.updateTime < LERP_DURATION_MS) {
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

      let selectedVehicle: { x: number; y: number; heading: number; color: string } | null = null;
      let hoveredVehicle: { x: number; y: number; heading: number; color: string } | null = null;

      const colorBatches = new Map<
        string,
        Array<{ x: number; y: number; heading: number }>
      >();

      for (const [, v] of store) {
        if (v.position[0] === 0 && v.position[1] === 0) continue;
        const fleet = fleetMap.get(v.id);
        if (fleet && hiddenFleets.has(fleet.id)) continue;

        // Interpolate position from stored state
        const state = interps.get(v.id);
        let lat: number, lng: number, heading: number;

        if (state) {
          const elapsed = now - state.updateTime;
          const t01 = Math.min(elapsed / LERP_DURATION_MS, 1);
          lat = lerp(state.prevLat, state.nextLat, t01);
          lng = lerp(state.prevLng, state.nextLng, t01);
          heading = lerpAngle(state.prevHeading, state.nextHeading, t01);
        } else {
          lat = v.position[0];
          lng = v.position[1];
          heading = ((v.heading ?? 0) * Math.PI) / 180;
        }

        // Projection expects [lng, lat]
        const pos = projectPosition([lng, lat]);
        if (!pos) continue;

        const [x, y] = pos;
        projected.push({ id: v.id, x, y });

        if (v.id === currentSelectedId) {
          selectedVehicle = { x, y, heading, color: fleet?.color ?? DEFAULT_FILL };
        } else if (v.id === currentHoveredId) {
          hoveredVehicle = { x, y, heading, color: fleet?.color ?? DEFAULT_FILL };
        } else {
          const color = resolveCSSColor(fleet?.color ?? DEFAULT_FILL);
          let batch = colorBatches.get(color);
          if (!batch) {
            batch = [];
            colorBatches.set(color, batch);
          }
          batch.push({ x, y, heading });
        }
      }

      projectedRef.current = projected;

      // Draw regular vehicles grouped by color
      for (const [color, vehicles] of colorBatches) {
        ctx.fillStyle = color;
        ctx.strokeStyle = DEFAULT_STROKE;
        ctx.lineWidth = 0.5;

        for (const v of vehicles) {
          ctx.save();
          ctx.translate(v.x, v.y);
          ctx.rotate(v.heading);
          ctx.beginPath();
          ctx.moveTo(AX[0] * s, AY[0] * s);
          ctx.lineTo(AX[1] * s, AY[1] * s);
          ctx.lineTo(AX[2] * s, AY[2] * s);
          ctx.lineTo(AX[3] * s, AY[3] * s);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      if (selectedVehicle && currentSelectedId) {
        drawSelectionRing(ctx, selectedVehicle.x, selectedVehicle.y, s);
      }

      if (hoveredVehicle) {
        drawGlowArrow(
          ctx,
          hoveredVehicle.x,
          hoveredVehicle.y,
          hoveredVehicle.heading,
          s,
          resolveCSSColor(hoveredVehicle.color),
          HOVER_STROKE,
          3,
        );
      }

      if (selectedVehicle) {
        drawGlowArrow(
          ctx,
          selectedVehicle.x,
          selectedVehicle.y,
          selectedVehicle.heading,
          s,
          resolveCSSColor(selectedVehicle.color),
          SELECTED_STROKE,
          4,
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

      const hitRadius = (8 * scale) / Math.pow(k, 0.75);
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

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { PolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { useMapContext, useOverlay } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";

interface GeofenceDrawToolProps {
  active: boolean;
  onComplete: (polygon: [number, number][]) => void;
  onCancel: () => void;
  /** Called whenever the vertex count changes (0 when idle/cancelled). */
  onVertexCountChange?: (count: number) => void;
  /**
   * Increment this to programmatically trigger completion (like the confirm button).
   * The tool fires onComplete with current vertices when this value changes.
   */
  confirmRequestId?: number;
}

// Hit-test radii (pixels) and drag threshold
const VERTEX_HIT_PX = 10;
const EDGE_HIT_PX = 8;
const DRAG_THRESHOLD_PX = 3;

type Hover =
  | { kind: "vertex"; index: number }
  | { kind: "first" }
  | { kind: "edge"; index: number; midpoint: [number, number] }
  | null;

function pixDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

/** Perpendicular distance from (px,py) to segment (ax,ay)-(bx,by) and the projected point. */
function pixSegDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; projX: number; projY: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return { dist: pixDist(px, py, ax, ay), projX: ax, projY: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return { dist: pixDist(px, py, projX, projY), projX, projY };
}

export default function GeofenceDrawTool({
  active,
  onComplete,
  onCancel,
  onVertexCountChange,
  confirmRequestId,
}: GeofenceDrawToolProps) {
  const { viewport } = useMapContext();
  const { mapHTMLElement } = useOverlay();

  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [cursorGeo, setCursorGeo] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  // Refs for stable access inside native DOM handlers
  const verticesRef = useRef(vertices);
  verticesRef.current = vertices;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const onVertexCountChangeRef = useRef(onVertexCountChange);
  onVertexCountChangeRef.current = onVertexCountChange;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const completeDrawing = useCallback(() => {
    const verts = verticesRef.current;
    if (verts.length < 3) return;
    const polygon = [...verts];
    setVertices([]);
    setCursorGeo(null);
    setHover(null);
    setDragging(null);
    onVertexCountChangeRef.current?.(0);
    onCompleteRef.current(polygon);
  }, []);
  const completeRef = useRef(completeDrawing);
  completeRef.current = completeDrawing;

  // Reset state when tool becomes inactive
  useEffect(() => {
    if (!active) {
      setVertices([]);
      setCursorGeo(null);
      setHover(null);
      setDragging(null);
    }
  }, [active]);

  // Notify parent of vertex count changes
  useEffect(() => {
    onVertexCountChangeRef.current?.(vertices.length);
  }, [vertices.length]);

  // Native DOM event handlers
  useEffect(() => {
    if (!active || !mapHTMLElement) return;

    const getMouse = (e: MouseEvent): { px: [number, number]; geo: [number, number] } | null => {
      const vp = viewportRef.current;
      if (!vp) return null;
      const rect = mapHTMLElement.getBoundingClientRect();
      const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      const geoArr = vp.unproject(px);
      if (!geoArr) return null;
      return { px, geo: [geoArr[0], geoArr[1]] };
    };

    const findHover = (px: [number, number]): Hover => {
      const vp = viewportRef.current;
      if (!vp) return null;
      const verts = verticesRef.current;
      if (verts.length === 0) return null;

      // Closest vertex within threshold
      let bestVi = -1;
      let bestVd = Infinity;
      for (let i = 0; i < verts.length; i++) {
        const p = vp.project([verts[i][0], verts[i][1]]);
        const d = pixDist(px[0], px[1], p[0], p[1]);
        if (d <= VERTEX_HIT_PX && d < bestVd) {
          bestVd = d;
          bestVi = i;
        }
      }
      if (bestVi >= 0) {
        if (bestVi === 0 && verts.length >= 3) return { kind: "first" };
        return { kind: "vertex", index: bestVi };
      }

      // Closest edge within threshold. While <3 vertices the polygon is open;
      // once ≥3 the last segment wraps to vertex 0.
      if (verts.length < 2) return null;
      const segCount = verts.length >= 3 ? verts.length : verts.length - 1;
      let bestEi = -1;
      let bestEd = Infinity;
      let bestProjX = 0;
      let bestProjY = 0;
      for (let i = 0; i < segCount; i++) {
        const a = vp.project([verts[i][0], verts[i][1]]);
        const j = (i + 1) % verts.length;
        const b = vp.project([verts[j][0], verts[j][1]]);
        const { dist, projX, projY } = pixSegDist(px[0], px[1], a[0], a[1], b[0], b[1]);
        if (dist <= EDGE_HIT_PX && dist < bestEd) {
          bestEd = dist;
          bestEi = i;
          bestProjX = projX;
          bestProjY = projY;
        }
      }
      if (bestEi >= 0) {
        const midGeo = vp.unproject([bestProjX, bestProjY]);
        if (midGeo) {
          return { kind: "edge", index: bestEi, midpoint: [midGeo[0], midGeo[1]] };
        }
      }

      return null;
    };

    // ── Vertex drag (intercepts deck.gl pan) ───────────────────────────
    // Mousedown on a vertex/first-vertex starts a potential drag and prevents
    // deck.gl from panning. Mousemove/mouseup are attached to window so the
    // drag continues even if the cursor leaves the map element.
    let downPx: [number, number] | null = null;
    let downVertexIndex: number | null = null;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const m = getMouse(e);
      if (!m || downPx === null || downVertexIndex === null) return;

      if (draggingRef.current === null) {
        const d = pixDist(downPx[0], downPx[1], m.px[0], m.px[1]);
        if (d <= DRAG_THRESHOLD_PX) return; // still a click
        setDragging(downVertexIndex);
      }

      const idx = downVertexIndex;
      setVertices((prev) => {
        if (idx >= prev.length) return prev;
        const next = [...prev];
        next[idx] = m.geo;
        return next;
      });
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);

      if (draggingRef.current !== null) {
        // End of a true drag — suppress the synthetic "click" that the
        // browser is about to dispatch so we don't accidentally append/close.
        const suppress = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", suppress, { capture: true, once: true });
        setDragging(null);
      }
      downPx = null;
      downVertexIndex = null;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const m = getMouse(e);
      if (!m) return;
      const target = findHover(m.px);
      if (target?.kind === "vertex" || target?.kind === "first") {
        // Lock this event so deck.gl doesn't start panning the map.
        e.stopPropagation();
        e.preventDefault();
        downPx = m.px;
        downVertexIndex = target.kind === "first" ? 0 : target.index;
        window.addEventListener("mousemove", handleWindowMouseMove, true);
        window.addEventListener("mouseup", handleWindowMouseUp, true);
      }
    };

    // ── Hover tracking (for layer highlights + cursor preview line) ────
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current !== null || downVertexIndex !== null) return;
      const m = getMouse(e);
      if (!m) return;
      setCursorGeo(m.geo);
      setHover(findHover(m.px));
    };

    const handleMouseLeave = () => {
      if (draggingRef.current !== null) return;
      setCursorGeo(null);
      setHover(null);
    };

    // ── Click: the browser dispatches this only when mousedown/mouseup
    // land in the same place (i.e. no pan), so it's the right signal for
    // "user tapped the map" — append / close / insert.
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (draggingRef.current !== null) return;
      const m = getMouse(e);
      if (!m) return;
      const target = findHover(m.px);

      if (target?.kind === "first") {
        completeRef.current();
      } else if (target?.kind === "edge") {
        const insertIdx = target.index + 1;
        setVertices((prev) => {
          const next = [...prev];
          next.splice(insertIdx, 0, target.midpoint);
          return next;
        });
      } else if (target?.kind === "vertex") {
        // No-op on plain vertex click — avoids duplicate points on top of handles.
      } else {
        setVertices((prev) => [...prev, m.geo]);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const m = getMouse(e);
      if (!m) return;
      const target = findHover(m.px);
      if (target?.kind === "vertex" || target?.kind === "first") {
        e.preventDefault();
        e.stopPropagation();
        const idx = target.kind === "first" ? 0 : target.index;
        setVertices((prev) => prev.filter((_, i) => i !== idx));
        setHover(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVertices([]);
        setCursorGeo(null);
        setHover(null);
        setDragging(null);
        onVertexCountChangeRef.current?.(0);
        onCancelRef.current();
      } else if (e.key === "Enter") {
        if (verticesRef.current.length >= 3) {
          e.preventDefault();
          completeRef.current();
        }
      }
    };

    // Use capture phase for mousedown so we can stopPropagation before
    // deck.gl's controller starts handling the pan.
    mapHTMLElement.addEventListener("mousedown", handleMouseDown, true);
    mapHTMLElement.addEventListener("mousemove", handleMouseMove);
    mapHTMLElement.addEventListener("mouseleave", handleMouseLeave);
    mapHTMLElement.addEventListener("click", handleClick);
    mapHTMLElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      mapHTMLElement.removeEventListener("mousedown", handleMouseDown, true);
      mapHTMLElement.removeEventListener("mousemove", handleMouseMove);
      mapHTMLElement.removeEventListener("mouseleave", handleMouseLeave);
      mapHTMLElement.removeEventListener("click", handleClick);
      mapHTMLElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
    };
  }, [active, mapHTMLElement]);

  // Trigger completion when confirmRequestId changes
  const prevConfirmIdRef = useRef(confirmRequestId);
  useEffect(() => {
    if (confirmRequestId === prevConfirmIdRef.current) return;
    prevConfirmIdRef.current = confirmRequestId;
    if (!active || verticesRef.current.length < 3) return;
    completeRef.current();
  }, [confirmRequestId, active]);

  // Build deck.gl layers for the in-progress polygon
  const layers = useMemo(() => {
    if (!active || vertices.length === 0) return [];

    const result = [];

    // Filled polygon (≥ 3 vertices)
    if (vertices.length >= 3) {
      result.push(
        new PolygonLayer({
          id: "geofence-draw-polygon",
          data: [{ polygon: vertices }],
          getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
          getFillColor: [59, 130, 246, 38],
          getLineColor: [59, 130, 246, 255],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          filled: true,
          stroked: true,
          pickable: false,
        })
      );
    }

    // Open chain line (while exactly 2 vertices, before polygon closes)
    const pathSegments: { path: [number, number][] }[] = [];
    if (vertices.length >= 2 && vertices.length < 3) {
      pathSegments.push({ path: vertices });
    }
    // Preview line from last vertex to cursor — suppressed while dragging or
    // while hovering over a vertex/edge (avoids visual noise).
    const showPreview =
      cursorGeo &&
      vertices.length >= 1 &&
      dragging === null &&
      (hover === null || hover.kind === "first");
    if (showPreview) {
      pathSegments.push({ path: [vertices[vertices.length - 1], cursorGeo!] });
    }
    if (pathSegments.length > 0) {
      result.push(
        new PathLayer({
          id: "geofence-draw-lines",
          data: pathSegments,
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [59, 130, 246, 179],
          getWidth: 1,
          widthUnits: "pixels",
          pickable: false,
        })
      );
    }

    // Phantom midpoint indicator on edge hover — "click here to insert"
    if (hover?.kind === "edge") {
      result.push(
        new ScatterplotLayer({
          id: "geofence-draw-edge-hint",
          data: [hover.midpoint],
          getPosition: (d: [number, number]) => d,
          getRadius: 4,
          radiusUnits: "pixels",
          getFillColor: [59, 130, 246, 140],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
        })
      );
    }

    // Vertex handles — hovered/dragged vertex renders larger; first vertex
    // turns green when it's the close-polygon target.
    const enlargedIndex =
      hover?.kind === "vertex" ? hover.index : hover?.kind === "first" ? 0 : dragging;
    const firstIsCloseTarget = hover?.kind === "first";

    const vertexData = vertices.map((v, i) => ({
      position: v,
      enlarged: i === enlargedIndex,
      closeTarget: i === 0 && firstIsCloseTarget,
    }));

    result.push(
      new ScatterplotLayer({
        id: "geofence-draw-vertices",
        data: vertexData,
        getPosition: (d: { position: [number, number] }) => d.position,
        getRadius: (d: { enlarged: boolean }) => (d.enlarged ? 6 : 4),
        radiusUnits: "pixels",
        getFillColor: (d: { closeTarget: boolean }) =>
          d.closeTarget ? [34, 197, 94, 255] : [59, 130, 246, 255],
        getLineColor: [255, 255, 255, 255],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: false,
        updateTriggers: {
          getRadius: [enlargedIndex],
          getFillColor: [firstIsCloseTarget],
        },
      })
    );

    // Close-polygon ring around first vertex once the polygon can close
    if (vertices.length >= 3) {
      result.push(
        new ScatterplotLayer({
          id: "geofence-draw-close-ring",
          data: [vertices[0]],
          getPosition: (d: [number, number]) => d,
          getRadius: firstIsCloseTarget ? 10 : 8,
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          getLineColor: firstIsCloseTarget ? [34, 197, 94, 255] : [59, 130, 246, 180],
          getLineWidth: firstIsCloseTarget ? 2 : 1,
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: false,
          updateTriggers: {
            getRadius: [firstIsCloseTarget],
            getLineColor: [firstIsCloseTarget],
            getLineWidth: [firstIsCloseTarget],
          },
        })
      );
    }

    return result;
  }, [active, vertices, cursorGeo, hover, dragging]);

  useRegisterLayers("geofence-draw", layers);

  // Hint overlay rendered over the map, outside the side panel.
  if (!active || !mapHTMLElement) return null;

  const hint =
    vertices.length === 0
      ? "Click the map to place points — at least 3 — Esc to cancel"
      : vertices.length < 3
        ? `${vertices.length} point${vertices.length === 1 ? "" : "s"} — add ${3 - vertices.length} more`
        : "Click the first point or press Enter to finish • drag to move • click an edge to insert • right-click to delete";

  return createPortal(
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(17, 24, 39, 0.92)",
        color: "#f3f4f6",
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0.2,
        pointerEvents: "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        zIndex: 10,
        maxWidth: "90%",
        textAlign: "center",
      }}
    >
      {hint}
    </div>,
    mapHTMLElement
  );
}

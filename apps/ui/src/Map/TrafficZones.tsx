import { useEffect, useMemo, useRef, useState } from "react";
import { PolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useHeatzoneEditorContext } from "@/data/HeatzoneEditorContext";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { useMapContext, useOverlay } from "@/components/Map/hooks";
import { resolveMapColor } from "@/lib/mapColor";
import { simplifyPath } from "@/utils/geometry/simplify";
import type { Heatzone, Position } from "@/types";

/** Fade in/out duration in milliseconds, matching SpeedLimitSigns. */
const FADE_DURATION_MS = 500;

const VERTEX_HIT_PX = 10;
const DRAG_THRESHOLD_PX = 3;
/** Pixel-space Douglas–Peucker tolerance — keeps ~8–40 vertices for a normal lasso. */
const DRAW_SIMPLIFY_PX = 4;

const DENSITY_LINE_RGBA = resolveMapColor("var(--color-overlay-density)", 153);
const SELECTED_LINE_RGBA = resolveMapColor("var(--color-overlay-density)", 255);
const WHITE_RGBA: [number, number, number, number] = [255, 255, 255, 255];
const DRAW_RGBA: [number, number, number, number] = [255, 255, 255, 220];

interface HeatzoneDatum {
  id: string;
  polygon: Position[];
  intensity: number;
  selected: boolean;
}

function pixDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Ray-casting point-in-polygon over a `[lng,lat]` ring. */
function pointInRing(pt: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Drop a trailing point that merely repeats the first (closed-ring duplicate). */
function openRing(ring: Position[]): Position[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Manual-heatzone layer: renders committed zones (intensity → fill alpha),
 * highlights the selected one, and hosts the lasso-draw / reshape / move
 * interactions. Interaction is done with native pointer handlers that intercept
 * mousedown in the capture phase to suppress deck.gl's pan — the same approach
 * as `GeofenceDrawTool` / `PendingDispatch` (deck.gl 9 has no editable-layers).
 */
export default function Heatzones({ visible }: { visible: boolean }) {
  const heatzones = useHeatzones();
  const editor = useHeatzoneEditorContext();
  const { viewport } = useMapContext();
  const { mapHTMLElement } = useOverlay();

  // In-progress freehand lasso (geo points), rendered live as a preview.
  const [drawPoints, setDrawPoints] = useState<Position[]>([]);

  // Effective geometry for a zone: the live draft (during a drag) wins over the
  // server copy so the shape follows the cursor smoothly.
  const effectiveCoords = (z: Heatzone): Position[] =>
    editor.draft && editor.draft.id === z.properties.id
      ? editor.draft.coordinates
      : (z.geometry.coordinates as Position[]);

  // ── Refs for stable access inside native DOM handlers ──────────────
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const heatzonesRef = useRef(heatzones);
  heatzonesRef.current = heatzones;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const drawPointsRef = useRef(drawPoints);
  drawPointsRef.current = drawPoints;

  // Reset any in-progress stroke when leaving draw mode.
  useEffect(() => {
    if (editor.mode !== "draw" && drawPoints.length > 0) setDrawPoints([]);
  }, [editor.mode, drawPoints.length]);

  // ── Native pointer interactions ────────────────────────────────────
  useEffect(() => {
    if (!mapHTMLElement) return;

    const getMouse = (e: MouseEvent): { px: [number, number]; geo: Position } | null => {
      const vp = viewportRef.current;
      if (!vp) return null;
      const rect = mapHTMLElement.getBoundingClientRect();
      const px: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
      const geo = vp.unproject(px);
      if (!geo) return null;
      return { px, geo: [geo[0], geo[1]] };
    };

    const selectedZone = (): Heatzone | undefined => {
      const id = editorRef.current.selectedId;
      if (!id) return undefined;
      return heatzonesRef.current.find((z) => z.properties.id === id);
    };

    /** Closest handle index of the selected zone within threshold, else -1. */
    const findHandle = (px: [number, number]): number => {
      const vp = viewportRef.current;
      const zone = selectedZone();
      if (!vp || !zone) return -1;
      const verts = openRing(
        editorRef.current.draft && editorRef.current.draft.id === zone.properties.id
          ? editorRef.current.draft.coordinates
          : (zone.geometry.coordinates as Position[])
      );
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < verts.length; i++) {
        const p = vp.project(verts[i]);
        const d = pixDist(px[0], px[1], p[0], p[1]);
        if (d <= VERTEX_HIT_PX && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    /** Topmost zone whose polygon contains the geo point. */
    const findZoneAt = (geo: Position): Heatzone | undefined => {
      const zones = heatzonesRef.current;
      for (let i = zones.length - 1; i >= 0; i--) {
        if (pointInRing(geo, zones[i].geometry.coordinates as Position[])) return zones[i];
      }
      return undefined;
    };

    // Per-gesture drag state.
    let downPx: [number, number] | null = null;
    let dragKind: "draw" | "vertex" | "body" | null = null;
    let dragVertexIndex = -1;
    let dragBaseCoords: Position[] = [];
    let dragDownGeo: Position | null = null;
    let dragCoords: Position[] = [];
    let moved = false;

    const suppressNextClick = () => {
      const suppress = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", suppress, { capture: true, once: true });
    };

    const handleWindowMouseMove = (e: MouseEvent) => {
      const m = getMouse(e);
      if (!m || dragKind === null) return;

      if (!moved && downPx) {
        if (pixDist(downPx[0], downPx[1], m.px[0], m.px[1]) <= DRAG_THRESHOLD_PX) {
          if (dragKind !== "draw") return; // still a click for select/reshape
        }
        moved = true;
      }

      if (dragKind === "draw") {
        setDrawPoints((prev) => [...prev, m.geo]);
        return;
      }

      const id = editorRef.current.selectedId;
      if (!id) return;

      if (dragKind === "vertex") {
        dragCoords = dragBaseCoords.map((v, i) => (i === dragVertexIndex ? m.geo : v));
      } else if (dragKind === "body" && dragDownGeo) {
        const dx = m.geo[0] - dragDownGeo[0];
        const dy = m.geo[1] - dragDownGeo[1];
        dragCoords = dragBaseCoords.map(([x, y]) => [x + dx, y + dy] as Position);
      }
      editorRef.current.setDraft(id, dragCoords);
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);

      const kind = dragKind;
      const id = editorRef.current.selectedId;
      dragKind = null;
      downPx = null;

      if (kind === "draw") {
        const vp = viewportRef.current;
        const pts = drawPointsRef.current;
        setDrawPoints([]);
        if (vp && pts.length >= 3) {
          const px = pts.map((p) => vp.project(p) as [number, number]);
          const simplified = simplifyPath(px, DRAW_SIMPLIFY_PX);
          const geo = simplified.map((p) => {
            const g = vp.unproject(p);
            return [g[0], g[1]] as Position;
          });
          editorRef.current.createFromLasso(geo);
        }
        suppressNextClick();
        return;
      }

      if (moved && id && (kind === "vertex" || kind === "body")) {
        editorRef.current.commitGeometry(id, dragCoords);
        suppressNextClick();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const mode = editorRef.current.mode;
      const m = getMouse(e);
      if (!m) return;
      moved = false;
      downPx = m.px;

      if (mode === "draw") {
        e.stopPropagation();
        e.preventDefault();
        dragKind = "draw";
        setDrawPoints([m.geo]);
        window.addEventListener("mousemove", handleWindowMouseMove, true);
        window.addEventListener("mouseup", handleWindowMouseUp, true);
        return;
      }

      const zone = selectedZone();
      if (zone) {
        const base = openRing(
          editorRef.current.draft && editorRef.current.draft.id === zone.properties.id
            ? editorRef.current.draft.coordinates
            : (zone.geometry.coordinates as Position[])
        );
        const handleIdx = findHandle(m.px);
        if (handleIdx >= 0) {
          e.stopPropagation();
          e.preventDefault();
          dragKind = "vertex";
          dragVertexIndex = handleIdx;
          dragBaseCoords = base;
          dragCoords = base;
          window.addEventListener("mousemove", handleWindowMouseMove, true);
          window.addEventListener("mouseup", handleWindowMouseUp, true);
          return;
        }
        if (pointInRing(m.geo, base)) {
          e.stopPropagation();
          e.preventDefault();
          dragKind = "body";
          dragBaseCoords = base;
          dragCoords = base;
          dragDownGeo = m.geo;
          window.addEventListener("mousemove", handleWindowMouseMove, true);
          window.addEventListener("mouseup", handleWindowMouseUp, true);
          return;
        }
      }
    };

    // Plain click (no drag) selects the zone under the cursor / deselects.
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const ed = editorRef.current;
      if (ed.mode === "draw") return;
      const m = getMouse(e);
      if (!m) return;
      const zone = findZoneAt(m.geo);
      if (zone) {
        if (zone.properties.id !== ed.selectedId) ed.select(zone.properties.id);
      } else if (ed.selectedId) {
        ed.deselect();
      }
    };

    mapHTMLElement.addEventListener("mousedown", handleMouseDown, true);
    mapHTMLElement.addEventListener("click", handleClick);
    return () => {
      mapHTMLElement.removeEventListener("mousedown", handleMouseDown, true);
      mapHTMLElement.removeEventListener("click", handleClick);
      window.removeEventListener("mousemove", handleWindowMouseMove, true);
      window.removeEventListener("mouseup", handleWindowMouseUp, true);
    };
  }, [mapHTMLElement]);

  // ── Display layer ──────────────────────────────────────────────────
  const displayLayers = useMemo(() => {
    if (!visible || heatzones.length === 0) return [];
    const data: HeatzoneDatum[] = heatzones.map((z) => ({
      id: z.properties.id,
      polygon: effectiveCoords(z),
      intensity: z.properties.intensity,
      selected: z.properties.id === editor.selectedId,
    }));
    return [
      new PolygonLayer<HeatzoneDatum>({
        id: "traffic-zones",
        data,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => {
          const [r, g, b] = resolveMapColor("var(--color-overlay-density)");
          return [r, g, b, Math.round(0.2 * d.intensity * 255)];
        },
        getLineColor: (d) => (d.selected ? SELECTED_LINE_RGBA : DENSITY_LINE_RGBA),
        getLineWidth: (d) => (d.selected ? 2.5 : 1),
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: true,
        updateTriggers: {
          getLineColor: [editor.selectedId],
          getLineWidth: [editor.selectedId],
        },
        transitions: {
          getFillColor: {
            duration: FADE_DURATION_MS,
            enter: (value: number[]) => [value[0], value[1], value[2], 0],
          },
        },
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, heatzones, editor.selectedId, editor.draft]);
  useRegisterLayers("traffic-zones", displayLayers);

  // ── Lasso draw-preview ─────────────────────────────────────────────
  const drawLayers = useMemo(() => {
    if (drawPoints.length < 2) return [];
    return [
      new PathLayer<{ path: Position[] }>({
        id: "heatzone-draw",
        data: [{ path: drawPoints }],
        getPath: (d) => d.path,
        getColor: DRAW_RGBA,
        getWidth: 2,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
        pickable: false,
      }),
    ];
  }, [drawPoints]);
  useRegisterLayers("heatzone-draw", drawLayers);

  // ── Vertex handles for the selected zone ───────────────────────────
  const handleLayers = useMemo(() => {
    if (editor.mode !== "selected" || !editor.selectedId) return [];
    const zone = heatzones.find((z) => z.properties.id === editor.selectedId);
    if (!zone) return [];
    const verts = openRing(effectiveCoords(zone));
    return [
      new ScatterplotLayer<Position>({
        id: "heatzone-handles",
        data: verts,
        getPosition: (d) => d,
        getRadius: 5,
        radiusUnits: "pixels",
        getFillColor: SELECTED_LINE_RGBA,
        getLineColor: WHITE_RGBA,
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: true,
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.mode, editor.selectedId, editor.draft, heatzones]);
  useRegisterLayers("heatzone-handles", handleLayers);

  return null;
}

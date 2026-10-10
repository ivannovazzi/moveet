import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { PolygonLayer } from "@deck.gl/layers";
import { useMapContext } from "@/components/Map/hooks";
import { useRegisterLayers } from "@/components/Map/hooks/useDeckLayers";
import { resolveMapColor } from "@/lib/mapColor";
import { setDraftArea, setDrawing, useAreaDraft } from "@/Maps/areaDraft";
import { bboxFromCorners, bboxRing } from "@/Maps/bbox";

/** Same blue as the geofence draw tool: geometry that is not committed yet. */
const DRAW_TOKEN = "var(--color-overlay-draw)";

/** A press that moves less than this is a click, not a box. */
const MIN_DRAG_PX = 6;

type Corner = [number, number];

/**
 * The Maps panel's area on the canvas: previews the box a new map would be
 * built from, and in draw mode lets the operator drag one out.
 *
 * Draw mode puts a transparent sheet over the canvas that owns the pointer, so
 * the drag never reaches deck.gl's pan controller and nothing else on the map
 * reacts to it. Escape (captured before the app's own Escape handling, which
 * would otherwise close the console) leaves draw mode and keeps the old box.
 */
export default function MapAreaLayer() {
  const { bbox, drawing } = useAreaDraft();
  const { viewport } = useMapContext();
  const [drag, setDrag] = useState<{ from: Corner; to: Corner } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startPx = useRef<Corner | null>(null);

  useEffect(() => {
    if (!drawing) {
      setDrag(null);
      startPx.current = null;
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setDrawing(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [drawing]);

  const locate = (e: PointerEvent<HTMLDivElement>): { px: Corner; geo: Corner } | null => {
    const sheet = sheetRef.current;
    if (!sheet || !viewport) return null;
    const rect = sheet.getBoundingClientRect();
    const px: Corner = [e.clientX - rect.left, e.clientY - rect.top];
    const geo = viewport.unproject(px);
    if (!geo || !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) return null;
    return { px, geo: [geo[0], geo[1]] };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const at = locate(e);
    if (!at) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPx.current = at.px;
    setDrag({ from: at.geo, to: at.geo });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!startPx.current) return;
    const at = locate(e);
    if (at) setDrag((d) => (d ? { from: d.from, to: at.geo } : d));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = startPx.current;
    startPx.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const at = locate(e);
    const from = drag?.from;
    setDrag(null);
    if (!start || !at || !from) return;
    // A click is not a box: stay in draw mode for another try.
    if (Math.hypot(at.px[0] - start[0], at.px[1] - start[1]) < MIN_DRAG_PX) return;
    setDraftArea(bboxFromCorners(from, at.geo), "draw");
  };

  const onPointerCancel = () => {
    startPx.current = null;
    setDrag(null);
  };

  const shown = drag ? bboxFromCorners(drag.from, drag.to) : bbox;

  const layers = useMemo(() => {
    if (!shown) return [];
    return [
      new PolygonLayer<{ polygon: Corner[] }>({
        id: "map-area-box",
        data: [{ polygon: bboxRing(shown) }],
        getPolygon: (d) => d.polygon,
        getFillColor: resolveMapColor(DRAW_TOKEN, 36),
        getLineColor: resolveMapColor(DRAW_TOKEN),
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        filled: true,
        stroked: true,
        pickable: false,
      }),
    ];
  }, [shown]);

  useRegisterLayers("map-area", layers);

  if (!drawing) return null;
  return (
    <div
      ref={sheetRef}
      data-testid="map-area-sheet"
      role="application"
      aria-label="Drag a rectangle to choose the new map's area. Escape cancels."
      className="absolute inset-0 z-10 cursor-crosshair touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

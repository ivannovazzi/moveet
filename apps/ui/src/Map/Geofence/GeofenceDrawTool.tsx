import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { PolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { useDeckMapContext, useDeckOverlay } from "@/components/Map/hooks";
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

export default function GeofenceDrawTool({
  active,
  onComplete,
  onCancel,
  onVertexCountChange,
  confirmRequestId,
}: GeofenceDrawToolProps) {
  const { viewport } = useDeckMapContext();
  const { mapHTMLElement } = useDeckOverlay();

  // Vertices in geo space [lng, lat]
  const [vertices, setVertices] = useState<[number, number][]>([]);
  // Cursor position in geo space [lng, lat]
  const [cursorGeo, setCursorGeo] = useState<[number, number] | null>(null);

  // Refs for stable callback access
  const verticesRef = useRef(vertices);
  verticesRef.current = vertices;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
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
    }
  }, [active]);

  // Notify parent of vertex count changes
  useEffect(() => {
    onVertexCountChangeRef.current?.(vertices.length);
  }, [vertices.length]);

  // Attach DOM event listeners to the map container
  useEffect(() => {
    if (!active || !mapHTMLElement) return;

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const vp = viewportRef.current;
      if (!vp) return;

      const rect = mapHTMLElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const coords = vp.unproject([x, y]);
      if (!coords) return;

      const point: [number, number] = [coords[0], coords[1]];
      setVertices((prev) => [...prev, point]);
    };

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      completeRef.current();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const vp = viewportRef.current;
      if (!vp) return;

      const rect = mapHTMLElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const coords = vp.unproject([x, y]);
      if (!coords) return;

      setCursorGeo([coords[0], coords[1]]);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVertices([]);
        setCursorGeo(null);
        onVertexCountChangeRef.current?.(0);
        onCancelRef.current();
      }
    };

    mapHTMLElement.addEventListener("click", handleClick);
    mapHTMLElement.addEventListener("dblclick", handleDblClick);
    mapHTMLElement.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      mapHTMLElement.removeEventListener("click", handleClick);
      mapHTMLElement.removeEventListener("dblclick", handleDblClick);
      mapHTMLElement.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
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

    // Polygon fill + stroke (>= 3 vertices)
    if (vertices.length >= 3) {
      result.push(
        new PolygonLayer({
          id: "geofence-draw-polygon",
          data: [{ polygon: vertices }],
          getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
          getFillColor: [59, 130, 246, 38], // rgba(59,130,246,0.15)
          getLineColor: [59, 130, 246, 255],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          filled: true,
          stroked: true,
          pickable: false,
        })
      );
    }

    // Lines between vertices (< 3 vertices, or the preview line to cursor)
    const pathSegments: { path: [number, number][] }[] = [];

    // When < 3 vertices, draw lines between them
    if (vertices.length >= 2 && vertices.length < 3) {
      pathSegments.push({ path: vertices });
    }

    // Preview line from last vertex to cursor
    if (cursorGeo && vertices.length >= 1) {
      pathSegments.push({
        path: [vertices[vertices.length - 1], cursorGeo],
      });
    }

    if (pathSegments.length > 0) {
      result.push(
        new PathLayer({
          id: "geofence-draw-lines",
          data: pathSegments,
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [59, 130, 246, 179], // ~0.7 opacity
          getWidth: 1,
          widthUnits: "pixels",
          pickable: false,
        })
      );
    }

    // Vertex handles
    result.push(
      new ScatterplotLayer({
        id: "geofence-draw-vertices",
        data: vertices,
        getPosition: (d: [number, number]) => d,
        getRadius: 4,
        radiusUnits: "pixels",
        getFillColor: [59, 130, 246, 255],
        getLineColor: [255, 255, 255, 255],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        stroked: true,
        pickable: false,
      })
    );

    return result;
  }, [active, vertices, cursorGeo]);

  useRegisterLayers("geofence-draw", layers);

  return null;
}

import { useEffect, useRef, useCallback } from "react";
import { pointer } from "d3";
import { useMapContext } from "@/components/Map/hooks";

interface GeofenceDrawToolProps {
  active: boolean;
  onComplete: (polygon: [number, number][]) => void;
  onCancel: () => void;
}

export default function GeofenceDrawTool({
  active,
  onComplete,
  onCancel,
}: GeofenceDrawToolProps) {
  const { map: svgRef, projection, transform } = useMapContext();

  // Vertices in SVG display space
  const svgVertices = useRef<[number, number][]>([]);
  // Vertices in geo space [lng, lat]
  const geoVertices = useRef<[number, number][]>([]);
  // Cursor position in SVG display space
  const cursorSvg = useRef<[number, number] | null>(null);

  // The <g> element we render into
  const gRef = useRef<SVGGElement | null>(null);

  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const redraw = useCallback(() => {
    const g = gRef.current;
    if (!g) return;
    g.innerHTML = "";

    const verts = svgVertices.current;
    const cursor = cursorSvg.current;

    if (verts.length === 0) return;

    // Draw polygon preview (filled) if >= 3 points
    if (verts.length >= 3) {
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute(
        "points",
        verts.map(([x, y]) => `${x},${y}`).join(" ")
      );
      polygon.setAttribute("fill", "rgba(59,130,246,0.15)");
      polygon.setAttribute("stroke", "rgb(59,130,246)");
      polygon.setAttribute("stroke-width", "1");
      polygon.setAttribute("stroke-dasharray", "4 3");
      g.appendChild(polygon);
    } else if (verts.length === 2) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(verts[0][0]));
      line.setAttribute("y1", String(verts[0][1]));
      line.setAttribute("x2", String(verts[1][0]));
      line.setAttribute("y2", String(verts[1][1]));
      line.setAttribute("stroke", "rgb(59,130,246)");
      line.setAttribute("stroke-width", "1");
      g.appendChild(line);
    }

    // Preview dashed line from last vertex to cursor
    if (cursor && verts.length >= 1) {
      const last = verts[verts.length - 1];
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "line");
      preview.setAttribute("x1", String(last[0]));
      preview.setAttribute("y1", String(last[1]));
      preview.setAttribute("x2", String(cursor[0]));
      preview.setAttribute("y2", String(cursor[1]));
      preview.setAttribute("stroke", "rgb(59,130,246)");
      preview.setAttribute("stroke-width", "1");
      preview.setAttribute("stroke-dasharray", "4 3");
      preview.setAttribute("opacity", "0.7");
      g.appendChild(preview);
    }

    // Draw vertex dots
    for (const [x, y] of verts) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", "rgb(59,130,246)");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "1");
      g.appendChild(circle);
    }
  }, []);

  useEffect(() => {
    if (!active || !svgRef) return;

    // Create overlay <g>
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-layer", "geofence-draw");
    g.style.pointerEvents = "none";

    // Insert inside the markers group so it participates in zoom transforms
    const markersGroup = svgRef.querySelector("g.markers");
    if (markersGroup) {
      markersGroup.appendChild(g);
    } else {
      svgRef.appendChild(g);
    }
    gRef.current = g;
    svgVertices.current = [];
    geoVertices.current = [];
    cursorSvg.current = null;

    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const proj = projectionRef.current;
      const t = transformRef.current;
      if (!proj) return;

      const [rawX, rawY] = pointer(e, svgRef);
      // Convert raw SVG pointer to map-space, then invert to geo coords
      const [mx, my] = t ? t.invert([rawX, rawY]) : [rawX, rawY];
      const coords = proj.invert?.([mx, my]);
      if (!coords) return;

      // Store SVG display position for rendering vertices
      const svgPt: [number, number] = t ? [t.applyX(mx), t.applyY(my)] : [mx, my];
      svgVertices.current = [...svgVertices.current, svgPt];
      geoVertices.current = [...geoVertices.current, coords as [number, number]];
      redraw();
    };

    const handleDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (geoVertices.current.length < 3) return;

      const polygon = [...geoVertices.current];
      svgVertices.current = [];
      geoVertices.current = [];
      cursorSvg.current = null;
      g.innerHTML = "";

      onComplete(polygon);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const t = transformRef.current;
      const [rawX, rawY] = pointer(e, svgRef);
      if (t) {
        const [mx, my] = t.invert([rawX, rawY]);
        cursorSvg.current = [t.applyX(mx), t.applyY(my)];
      } else {
        cursorSvg.current = [rawX, rawY];
      }
      redraw();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        svgVertices.current = [];
        geoVertices.current = [];
        cursorSvg.current = null;
        g.innerHTML = "";
        onCancel();
      }
    };

    svgRef.addEventListener("click", handleClick);
    svgRef.addEventListener("dblclick", handleDblClick);
    svgRef.addEventListener("mousemove", handleMouseMove);
    svgRef.addEventListener("keydown", handleKeyDown);

    return () => {
      svgRef.removeEventListener("click", handleClick);
      svgRef.removeEventListener("dblclick", handleDblClick);
      svgRef.removeEventListener("mousemove", handleMouseMove);
      svgRef.removeEventListener("keydown", handleKeyDown);
      g.remove();
      gRef.current = null;
      svgVertices.current = [];
      geoVertices.current = [];
      cursorSvg.current = null;
    };
  }, [active, svgRef, redraw, onComplete, onCancel]);

  // Renders nothing into React's tree — SVG is managed via DOM
  return null;
}

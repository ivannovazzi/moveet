import type { MouseEventHandler } from "react";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { select, geoMercator, geoPath, zoom, pointer, zoomIdentity } from "d3";
import type { GeoProjection, ZoomTransform, ZoomBehavior } from "d3";
import type { Position, RoadNetwork } from "@/types";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { MapControlsProvider } from "../providers/ControlsContextProvider";
import { MapContextProvider } from "../providers/MapContextProvider";
import { OverlayProvider } from "../providers/OverlayContextProvider";
interface RoadNetworkMapProps {
  data: RoadNetwork;
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  children?: React.ReactNode;
  htmlMarkers?: React.ReactNode;
  onClick?: (event: React.MouseEvent, position: Position) => void;
  onContextClick?: (event: React.MouseEvent, position: Position) => void;
  cursor?: string;
}

export const RoadNetworkMap: React.FC<RoadNetworkMapProps> = ({
  data,
  strokeColor = "#33f",
  strokeWidth = 1.5,
  strokeOpacity = 0.4,
  children,
  onClick,
  onContextClick,
  htmlMarkers,
  cursor = "grab",
}) => {
  const htmlItemsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgRef, setSvgRef] = useState<SVGSVGElement | null>(null);
  const [projection, setProjection] = useState<GeoProjection | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [zoomState, setZoomState] = useState<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [containerRef, size] = useResizeObserver();

  // Ref so drawRoads can always access the latest values without re-registering zoom
  const projectionRef = useRef<GeoProjection | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const dataRef = useRef<RoadNetwork | null>(null);
  const drawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawRoads = useCallback((proj: GeoProjection, t: ZoomTransform, network: RoadNetwork) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Apply zoom transform to a copy of the projection so we draw at screen coords
    const scaled = geoMercator()
      .translate([proj.translate()[0] * t.k + t.x, proj.translate()[1] * t.k + t.y])
      .scale(proj.scale() * t.k);

    const pathGen = geoPath().projection(scaled).context(ctx);

    ctx.globalAlpha = strokeOpacity;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Batch by stroke style for fewer ctx state changes
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    for (const feature of network.features) {
      if (feature.properties.type !== "highway") pathGen(feature);
    }
    ctx.stroke();

    ctx.strokeStyle = "#222";
    ctx.lineWidth = strokeWidth * 2;
    ctx.beginPath();
    for (const feature of network.features) {
      if (feature.properties.type === "highway") pathGen(feature);
    }
    ctx.stroke();

    ctx.globalAlpha = 1;
  }, [strokeColor, strokeWidth, strokeOpacity]);

  useEffect(() => {
    if (!svgRef || !size.width || !size.height || !data) return;

    const svg = select(svgRef);
    svg.attr("width", size.width).attr("height", size.height);

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = size.width;
      canvas.height = size.height;
    }

    const proj = geoMercator().fitSize([size.width, size.height], data);
    setProjection(() => proj);
    projectionRef.current = proj;
    dataRef.current = data;

    drawRoads(proj, transformRef.current, data);

    const markersGroup = svg.select<SVGGElement>("g.markers");

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 15])
      .on("zoom", (evt) => {
        const t: ZoomTransform = evt.transform;
        transformRef.current = t;

        requestAnimationFrame(() => {
          // Canvas: cheap CSS transform during active pan/zoom
          if (canvas) {
            canvas.style.transformOrigin = "0 0";
            canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
          }

          markersGroup.attr("transform", t.toString());

          if (htmlItemsRef.current) {
            htmlItemsRef.current.style.transformOrigin = "0% 0%";
            htmlItemsRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
          }

          setTransform(t);
        });

        // Redraw at full resolution shortly after zooming stops
        if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
        drawTimerRef.current = setTimeout(() => {
          if (canvas) {
            canvas.style.transform = "";
          }
          if (projectionRef.current && dataRef.current) {
            drawRoads(projectionRef.current, t, dataRef.current);
          }
        }, 150);
      });

    setZoomState(() => zoomBehavior);
    svg.call(zoomBehavior);
  }, [data, size, svgRef, drawRoads]);

  const getBoundingBox = useCallback(() => {
    let boundingBox = [
      [0, 0],
      [0, 0],
    ] as [Position, Position];
    if (projection && transform && size.width && size.height) {
      const topLeft = projection.invert?.(transform.invert([0, 0])) ?? [0, 0];
      const bottomRight = projection.invert?.(transform.invert([size.width, size.height])) ?? [
        0, 0,
      ];
      boundingBox = [topLeft, bottomRight];
    }
    return boundingBox;
  }, [projection, transform, size.width, size.height]);

  const getZoom = useCallback(() => transform?.k ?? 0, [transform]);

  const onSvgClick: MouseEventHandler<SVGSVGElement> = useCallback(
    (evt) => {
      if (!projection || !transform) return;
      const [sx, sy] = pointer(evt, svgRef);
      const [mx, my] = transform.invert([sx, sy]);
      const coords = projection.invert?.([mx, my]);
      if (!coords) return;
      onClick?.(evt, coords);
    },
    [projection, transform, svgRef, onClick]
  );

  const onSvgContextClick: MouseEventHandler<SVGSVGElement> = useCallback(
    (evt) => {
      if (!projection || !transform) return;
      const [sx, sy] = pointer(evt, svgRef);
      const [mx, my] = transform.invert([sx, sy]);
      const coords = projection.invert?.([mx, my]);
      if (!coords) return;
      onContextClick?.(evt, coords);
    },
    [projection, transform, svgRef, onContextClick]
  );

  const onSvgKeyDown = useCallback(
    (evt: React.KeyboardEvent<SVGSVGElement>) => {
      // Shift+F10 or the ContextMenu key opens the context menu
      const isShiftF10 = evt.key === "F10" && evt.shiftKey;
      const isContextMenuKey = evt.key === "ContextMenu";
      if (!isShiftF10 && !isContextMenuKey) return;
      if (!projection || !transform || !svgRef) return;

      evt.preventDefault();

      // Use the center of the SVG as the context position
      const rect = svgRef.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const [mx, my] = transform.invert([cx, cy]);
      const coords = projection.invert?.([mx, my]);
      if (!coords) return;

      // Create a synthetic mouse event for the context menu handler
      const syntheticEvent = {
        ...evt,
        clientX: rect.left + cx,
        clientY: rect.top + cy,
        preventDefault: () => evt.preventDefault(),
        stopPropagation: () => evt.stopPropagation(),
      } as unknown as React.MouseEvent;

      onContextClick?.(syntheticEvent, coords);
    },
    [projection, transform, svgRef, onContextClick]
  );

  return (
    <MapContextProvider
      map={svgRef}
      projection={projection}
      transform={transform}
      getBoundingBox={getBoundingBox}
      getZoom={getZoom}
    >
      <MapControlsProvider svgRef={svgRef} zoomBehavior={zoomState} projection={projection}>
        <OverlayProvider
          projection={projection}
          transform={transform}
          getRef={() => containerRef.current}
        >
          <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                background: "#111",
              }}
            />
            <svg
              ref={setSvgRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                display: "block",
                cursor,
              }}
              tabIndex={0}
              aria-label="Road network map"
              onClick={onSvgClick}
              onContextMenu={onSvgContextClick}
              onKeyDown={onSvgKeyDown}
            >
              <g className="markers">{children}</g>
            </svg>
            <div style={{ position: "absolute", top: 0, left: 0 }} ref={htmlItemsRef}>
              {htmlMarkers}
            </div>
          </div>
        </OverlayProvider>
      </MapControlsProvider>
    </MapContextProvider>
  );
};

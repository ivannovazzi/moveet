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

  // Pre-baked Path2D objects — built once per data/size, reused every frame
  const roadPathRef = useRef<Path2D | null>(null);
  const highwayPathRef = useRef<Path2D | null>(null);
  const projectionRef = useRef<GeoProjection | null>(null);
  const rafRef = useRef<number | null>(null);

  const drawRoads = useCallback(
    (t: ZoomTransform) => {
      const canvas = canvasRef.current;
      if (!canvas || !roadPathRef.current || !highwayPathRef.current) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply zoom transform as a canvas matrix — no coordinate re-projection per frame
      ctx.save();
      ctx.transform(t.k, 0, 0, t.k, t.x, t.y);

      ctx.globalAlpha = strokeOpacity;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // Keep line width constant in screen pixels regardless of zoom
      ctx.lineWidth = strokeWidth / t.k;

      ctx.strokeStyle = strokeColor;
      ctx.stroke(roadPathRef.current);

      ctx.strokeStyle = "#444";
      ctx.lineWidth = (strokeWidth * 2) / t.k;
      ctx.stroke(highwayPathRef.current);

      ctx.globalAlpha = 1;
      ctx.restore();
    },
    [strokeColor, strokeWidth, strokeOpacity]
  );

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

    // Pre-bake all road geometry into Path2D objects at the base projection.
    // geoPath() without a canvas context returns SVG path strings which Path2D accepts.
    const pathGen = geoPath().projection(proj);
    const roadPath = new Path2D();
    const highwayPath = new Path2D();
    for (const feature of data.features) {
      const d = pathGen(feature);
      if (!d) continue;
      if (feature.properties.type === "highway") {
        highwayPath.addPath(new Path2D(d));
      } else {
        roadPath.addPath(new Path2D(d));
      }
    }
    roadPathRef.current = roadPath;
    highwayPathRef.current = highwayPath;

    drawRoads(zoomIdentity);

    const markersGroup = svg.select<SVGGElement>("g.markers");

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 15])
      .on("zoom", (evt) => {
        const t: ZoomTransform = evt.transform;

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          drawRoads(t);

          markersGroup.attr("transform", t.toString());

          if (htmlItemsRef.current) {
            htmlItemsRef.current.style.transformOrigin = "0% 0%";
            htmlItemsRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
          }

          setTransform(t);
        });
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
      const isShiftF10 = evt.key === "F10" && evt.shiftKey;
      const isContextMenuKey = evt.key === "ContextMenu";
      if (!isShiftF10 && !isContextMenuKey) return;
      if (!projection || !transform || !svgRef) return;

      evt.preventDefault();

      const rect = svgRef.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const [mx, my] = transform.invert([cx, cy]);
      const coords = projection.invert?.([mx, my]);
      if (!coords) return;

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

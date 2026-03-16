import type { MouseEventHandler } from "react";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { select, geoMercator, geoPath, geoLength, zoom, pointer, zoomIdentity } from "d3";
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
  const [svgRef, setSvgRef] = useState<SVGSVGElement | null>(null);
  const [projection, setProjection] = useState<GeoProjection | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [zoomState, setZoomState] = useState<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [containerRef, size] = useResizeObserver();

  useEffect(() => {
    if (!svgRef || !size.width || !size.height || !data) return;

    const svg = select(svgRef);
    svg.selectAll("g.roads").remove();
    svg.attr("width", size.width).attr("height", size.height);

    const proj = geoMercator().fitSize([size.width, size.height], data);
    const pathGen = geoPath().projection(proj);
    setProjection(() => proj);

    const roadsGroup = svg.insert("g", ":first-child").attr("class", "roads").attr("opacity", strokeOpacity);

    // Filter and cache long main roads first
    const mainRoads = data.features.filter((d) => {
      if (!d.properties.name) return false;
      if (d.properties.highway === "primary") return true;
      const length = geoLength(d);
      return length > 0.0001; // Stricter threshold
    });

    // Add roads
    roadsGroup
      .selectAll("path")
      .data(data.features)
      .enter()
      .append("path")
      .attr("d", pathGen)
      .attr("fill", "none")
      .attr("stroke", (d) => (d.properties.type === "highway" ? "#222" : strokeColor))
      .attr("stroke-width", (d) =>
        d.properties.type === "highway" ? strokeWidth * 2 : strokeWidth
      )
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("id", (d, i) => (mainRoads.includes(d) ? `road-${i}` : null));

    const labelsGroup = roadsGroup.append("g").attr("class", "street-labels").style("opacity", 0.4);

    const markersGroup = svg.select<SVGGElement>("g.markers");

    // Simplified zoom handler
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 15])
      .on("zoom", (evt) => {
        requestAnimationFrame(() => {
          roadsGroup.attr("transform", evt.transform.toString());
          markersGroup.attr("transform", evt.transform.toString());
          labelsGroup.style("opacity", evt.transform.k > 6 ? 0.9 : 0);

          if (htmlItemsRef.current) {
            htmlItemsRef.current.style.transformOrigin = "0% 0%";
            htmlItemsRef.current.style.transform = `translate(${evt.transform.x}px, ${evt.transform.y}px) scale(${evt.transform.k})`;
          }

          setTransform(evt.transform);
        });
      });

    setZoomState(() => zoomBehavior);
    svg.call(zoomBehavior);
  }, [data, size, strokeColor, strokeWidth, strokeOpacity, svgRef]);

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
            <svg
              ref={setSvgRef}
              style={{
                width: "100%",
                height: "100%",
                background: "#111",
                display: "block",
                cursor,
              }}
              onClick={onSvgClick}
              onContextMenu={onSvgContextClick}
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

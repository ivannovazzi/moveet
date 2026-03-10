import React, { useRef, useLayoutEffect } from "react";
import { useMapContext } from "../hooks";
import type { Position } from "@/types";

interface HtmlMarkerProps extends React.HTMLAttributes<HTMLDivElement> {
  position: Position;
  offset?: [number, number];
  children?: React.ReactNode;
}

export default function HTMLMarker({
  position,
  offset = [0, 0],
  children,
  ...props
}: HtmlMarkerProps) {
  const { projection, transform } = useMapContext();
  const markerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!markerRef.current || !projection || !transform) return;
    const [x, y] = projection(position) ?? [0, 0];
    // The marker is scaled by the inverse of the zoom level
    markerRef.current.style.transform = `translate3d(${x + offset[0]}px, ${
      y + offset[1]
    }px, 0) scale(${1 / transform.k})`;
  }, [position, offset, projection, transform]);

  const style: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    height: 0,
    width: 0,
  };

  return (
    <div ref={markerRef} style={style} {...props}>
      {children}
    </div>
  );
}

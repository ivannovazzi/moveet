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
  const { viewport, viewState } = useMapContext();
  const markerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!markerRef.current || !viewport) return;

    const [x, y] = viewport.project([position[0], position[1]]);
    markerRef.current.style.transform = `translate3d(${x + offset[0]}px, ${y + offset[1]}px, 0)`;
  }, [position, offset, viewport, viewState]);

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

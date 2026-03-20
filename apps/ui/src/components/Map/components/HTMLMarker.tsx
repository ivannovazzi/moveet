import React, { useRef, useLayoutEffect } from "react";
import { useMapContext, useDeckMapContext } from "../hooks";
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
  const d3Ctx = useMapContext();
  const deckCtx = useDeckMapContext();
  const markerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!markerRef.current) return;

    // deck.gl mode: viewport is available
    if (deckCtx.viewport) {
      const [x, y] = deckCtx.viewport.project([position[0], position[1]]);
      // Scale inversely with zoom so markers keep constant screen size
      const scale = Math.pow(2, 12 - (deckCtx.viewState?.zoom ?? 12));
      markerRef.current.style.transform = `translate3d(${x + offset[0]}px, ${
        y + offset[1]
      }px, 0) scale(${Math.min(scale, 2)})`;
      return;
    }

    // Legacy D3 mode
    const { projection, transform } = d3Ctx;
    if (!projection || !transform) return;
    const [x, y] = projection(position) ?? [0, 0];
    markerRef.current.style.transform = `translate3d(${x + offset[0]}px, ${
      y + offset[1]
    }px, 0) scale(${1 / transform.k})`;
  }, [position, offset, d3Ctx, deckCtx]);

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

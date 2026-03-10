import React from "react";
import { createPortal } from "react-dom";
import { useHTMLTransformer } from "../hooks";
import type { Position } from "@/types";

interface OverlayProps {
  children: React.ReactNode;
  position: Position;
}

function OverlayComponent({ children, position }: OverlayProps) {
  const { mapHTMLElement, htmlTransform } = useHTMLTransformer();
  if (!htmlTransform) return null;

  const [x, y] = htmlTransform(position);

  return createPortal(
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {children}
    </div>,
    mapHTMLElement!
  );
}

export default React.memo(
  OverlayComponent,
  (prev, next) => prev.position[0] === next.position[0] && prev.position[1] === next.position[1]
);

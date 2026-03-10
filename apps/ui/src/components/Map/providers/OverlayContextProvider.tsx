import React, { useCallback, useMemo } from "react";
import type { GeoProjection, ZoomTransform } from "d3";
import type { Position } from "@/types";
import { OverlayContext } from "./contexts";
import { setHTMLTransformer } from "./htmlRenderer";

interface Props {
  projection: GeoProjection | null;
  transform: ZoomTransform | null;
  getRef: () => HTMLElement | null;
  children: React.ReactNode;
}

export const OverlayProvider: React.FC<Props> = ({ projection, transform, getRef, children }) => {
  const htmlTransform = useCallback(
    (position: Position): Position => {
      if (!projection || !transform) return position;
      const [x, y] = projection(position) || [0, 0];
      return [x + transform.x, y + transform.y];
    },
    [projection, transform]
  );

  const transformData = useMemo(() => {
    const mapHTMLElement = getRef();
    return {
      mapHTMLElement,
      htmlTransform,
    };
  }, [getRef, htmlTransform]);

  setHTMLTransformer(transformData);

  return <OverlayContext.Provider value={transformData}>{children}</OverlayContext.Provider>;
};

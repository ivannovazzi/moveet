import React, { useCallback, useMemo } from "react";
import type { GeoProjection, ZoomTransform } from "d3";
import type { WebMercatorViewport } from "@deck.gl/core";
import type { Position } from "@/types";
import { OverlayContext, DeckOverlayContext } from "./contexts";
import { setHTMLTransformer } from "./htmlRenderer";

// ─── Legacy D3-based overlay provider ──────────────────────────────

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

// ─── New deck.gl overlay provider ──────────────────────────────────

interface DeckOverlayProps {
  viewport: WebMercatorViewport | null;
  getRef: () => HTMLElement | null;
  children: React.ReactNode;
}

export const DeckOverlayProvider: React.FC<DeckOverlayProps> = ({ viewport, getRef, children }) => {
  // Also update the legacy htmlTransformRef so existing imperative code keeps working
  const htmlTransform = useCallback(
    (position: Position): Position => {
      if (!viewport) return position;
      const [x, y] = viewport.project([position[0], position[1]]);
      return [x, y];
    },
    [viewport]
  );

  const legacyData = useMemo(() => {
    const mapHTMLElement = getRef();
    return { mapHTMLElement, htmlTransform };
  }, [getRef, htmlTransform]);

  setHTMLTransformer(legacyData);

  const value = useMemo(() => {
    const mapHTMLElement = getRef();
    return { viewport, mapHTMLElement };
  }, [viewport, getRef]);

  return <DeckOverlayContext.Provider value={value}>{children}</DeckOverlayContext.Provider>;
};

import { useCallback, useMemo } from "react";
import type { WebMercatorViewport } from "@deck.gl/core";
import type { Position } from "@/types";
import { DeckOverlayContext } from "./contexts";
import { setHTMLTransformer } from "./htmlRenderer";

interface DeckOverlayProps {
  viewport: WebMercatorViewport | null;
  getRef: () => HTMLElement | null;
  children: React.ReactNode;
}

export const DeckOverlayProvider: React.FC<DeckOverlayProps> = ({ viewport, getRef, children }) => {
  // Update the htmlTransformRef so existing imperative code keeps working
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

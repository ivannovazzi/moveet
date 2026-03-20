import { useContext } from "react";
import { controlsRef } from "./providers/controls";
import { htmlTransformRef } from "./providers/htmlRenderer";
import { MapContext, DeckMapContext, DeckOverlayContext } from "./providers/contexts";

export function useMapControls() {
  return controlsRef;
}

export function useMapContext() {
  return useContext(MapContext);
}

export function useDeckMapContext() {
  return useContext(DeckMapContext);
}

export function useDeckOverlay() {
  return useContext(DeckOverlayContext);
}

export function useHTMLTransformer() {
  return htmlTransformRef;
}

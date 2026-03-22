import { useContext } from "react";
import { controlsRef } from "./providers/controls";
import { htmlTransformRef } from "./providers/htmlRenderer";
import { DeckMapContext, DeckOverlayContext } from "./providers/contexts";

export function useMapControls() {
  return controlsRef;
}

export function useMapContext() {
  return useContext(DeckMapContext);
}

export function useOverlay() {
  return useContext(DeckOverlayContext);
}

export function useHTMLTransformer() {
  return htmlTransformRef;
}

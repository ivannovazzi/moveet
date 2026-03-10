import { useContext } from "react";
import { controlsRef } from "./providers/controls";
import { htmlTransformRef } from "./providers/htmlRenderer";
import { MapContext } from "./providers/contexts";

export function useMapControls() {
  return controlsRef;
}

export function useMapContext() {
  return useContext(MapContext);
}

export function useHTMLTransformer() {
  return htmlTransformRef;
}

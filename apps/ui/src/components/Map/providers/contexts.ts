import { createContext } from "react";
import type { OverlayContextValue, MapContextValue, MapControlsContextValue } from "./types";

export const MapContext = createContext<MapContextValue>({
  map: null,
  projection: null,
  transform: null,
  getBoundingBox: () => [
    [0, 0],
    [0, 0],
  ],
  getZoom: () => 0,
});

export const MapControlsContext = createContext<MapControlsContextValue>({
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  setBounds: () => {},
  focusOn: () => {},
});

export const OverlayContext = createContext<OverlayContextValue>({
  htmlTransform: null,
  mapHTMLElement: null,
});

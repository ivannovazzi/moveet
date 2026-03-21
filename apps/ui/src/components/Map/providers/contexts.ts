import { createContext } from "react";
import type {
  MapControlsContextValue,
  DeckMapContextValue,
  DeckOverlayContextValue,
} from "./types";

export const DeckMapContext = createContext<DeckMapContextValue>({
  viewport: null,
  viewState: null,
  getBoundingBox: () => [
    [0, 0],
    [0, 0],
  ],
  getZoom: () => 0,
  project: () => null,
});

export const DeckOverlayContext = createContext<DeckOverlayContextValue>({
  viewport: null,
  mapHTMLElement: null,
});

export const MapControlsContext = createContext<MapControlsContextValue>({
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  setBounds: () => {},
  focusOn: () => {},
});

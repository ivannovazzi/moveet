import { createContext } from "react";
import type {
  OverlayContextValue,
  MapContextValue,
  MapControlsContextValue,
  DeckMapContextValue,
  DeckOverlayContextValue,
} from "./types";

// ─── Legacy D3-based contexts (still used by RoadNetworkMap) ───────

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

export const OverlayContext = createContext<OverlayContextValue>({
  htmlTransform: null,
  mapHTMLElement: null,
});

// ─── New deck.gl contexts ──────────────────────────────────────────

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

// ─── Shared controls context (works for both D3 and deck.gl) ───────

export const MapControlsContext = createContext<MapControlsContextValue>({
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  setBounds: () => {},
  focusOn: () => {},
});

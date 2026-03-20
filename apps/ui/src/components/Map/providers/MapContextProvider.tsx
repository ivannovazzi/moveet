import type { GeoProjection, ZoomTransform } from "d3";
import type { WebMercatorViewport, MapViewState } from "@deck.gl/core";
import type { Position } from "@/types";
import { MapContext, DeckMapContext } from "./contexts";

// ─── Legacy D3-based provider (used by RoadNetworkMap) ─────────────

interface Props {
  map: SVGSVGElement | null;
  projection: GeoProjection | null;
  transform: ZoomTransform | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
  children: React.ReactNode;
}

export const MapContextProvider: React.FC<Props> = ({
  map,
  projection,
  transform,
  getBoundingBox,
  getZoom,
  children,
}) => (
  <MapContext.Provider value={{ map, projection, transform, getBoundingBox, getZoom }}>
    {children}
  </MapContext.Provider>
);

// ─── New deck.gl provider (used by DeckGLMap) ──────────────────────

interface DeckProps {
  viewport: WebMercatorViewport | null;
  viewState: MapViewState | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
  project: (position: Position) => [number, number] | null;
  children: React.ReactNode;
}

export const DeckMapContextProvider: React.FC<DeckProps> = ({
  viewport,
  viewState,
  getBoundingBox,
  getZoom,
  project,
  children,
}) => (
  <DeckMapContext.Provider value={{ viewport, viewState, getBoundingBox, getZoom, project }}>
    {children}
  </DeckMapContext.Provider>
);

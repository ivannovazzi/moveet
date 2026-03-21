import type { WebMercatorViewport, MapViewState } from "@deck.gl/core";
import type { Position } from "@/types";
import { DeckMapContext } from "./contexts";

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

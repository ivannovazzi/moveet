import type { GeoProjection, ZoomTransform } from "d3";
import type { Position } from "@/types";
import { MapContext } from "./contexts";

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

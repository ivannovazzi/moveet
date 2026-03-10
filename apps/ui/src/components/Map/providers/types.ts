import type { GeoProjection, ZoomTransform } from "d3";
import type { Position } from "@/types";

export interface PanToOptions {
  duration: number;
}

export interface MapContextValue {
  map: SVGSVGElement | null;
  projection: GeoProjection | null;
  transform: ZoomTransform | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
}

export interface MapControlsContextValue {
  zoomIn: () => void;
  zoomOut: () => void;
  panTo: (lng: number, lat: number, options: PanToOptions) => void;
  setZoom: (zoom: number) => void;
  setBounds: (bounds: [Position, Position]) => void;
  focusOn: (lng: number, lat: number, zoom: number, options: PanToOptions) => void;
}

export interface OverlayContextValue {
  mapHTMLElement: HTMLElement | null;
  htmlTransform: ((position: Position) => Position) | null;
}

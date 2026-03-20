import type { GeoProjection, ZoomTransform } from "d3";
import type { WebMercatorViewport, MapViewState } from "@deck.gl/core";
import type { Position } from "@/types";

export interface PanToOptions {
  duration: number;
}

// ─── Legacy D3-based context (still used by RoadNetworkMap) ────────

export interface MapContextValue {
  map: SVGSVGElement | null;
  projection: GeoProjection | null;
  transform: ZoomTransform | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
}

// ─── New deck.gl-based context ─────────────────────────────────────

export interface DeckMapContextValue {
  viewport: WebMercatorViewport | null;
  viewState: MapViewState | null;
  getBoundingBox: () => [Position, Position];
  getZoom: () => number;
  /** Convenience: project [lng, lat] to [x, y] screen pixels */
  project: (position: Position) => [number, number] | null;
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

// ─── New deck.gl overlay context ───────────────────────────────────

export interface DeckOverlayContextValue {
  viewport: WebMercatorViewport | null;
  mapHTMLElement: HTMLElement | null;
}

/** Subset of MapControlsContextValue — returned by useDeckViewState */
export type DeckViewStateControls = MapControlsContextValue;

import type { WebMercatorViewport, MapViewState } from "@deck.gl/core";
import type { Position } from "@/types";

export interface PanToOptions {
  duration: number;
}

export interface DeckMapContextValue {
  viewport: WebMercatorViewport | null;
  viewState: MapViewState | null;
  /** Returns [[west, south], [east, north]] i.e. [[minLng, minLat], [maxLng, maxLat]]. */
  getBoundingBox: () => [[number, number], [number, number]];
  getZoom: () => number;
  /** Convenience: project [lng, lat] to [x, y] screen pixels */
  project: (position: Position) => [number, number] | null;
}

export interface MapControlsContextValue {
  zoomIn: () => void;
  zoomOut: () => void;
  panTo: (lng: number, lat: number, options: PanToOptions) => void;
  setZoom: (zoom: number) => void;
  /** Current map zoom — for callers outside the map providers (e.g. useTracking). */
  getZoom: () => number;
  setBounds: (bounds: [Position, Position]) => void;
  focusOn: (lng: number, lat: number, zoom: number, options: PanToOptions) => void;
  /** Lean the camera to an absolute pitch in degrees (clamped to the max pitch). */
  setPitch: (pitch: number) => void;
  /** Current pitch in degrees — 0 while the map is flat. */
  getPitch: () => number;
  /** Flat ⇄ leaning, for the cluster's tilt key and the `t` shortcut. */
  toggleTilt: () => void;
}

export interface OverlayContextValue {
  mapHTMLElement: HTMLElement | null;
  htmlTransform: ((position: Position) => Position) | null;
}

export interface DeckOverlayContextValue {
  viewport: WebMercatorViewport | null;
  mapHTMLElement: HTMLElement | null;
}

/** Subset of MapControlsContextValue — returned by useDeckViewState */
export type DeckViewStateControls = MapControlsContextValue;

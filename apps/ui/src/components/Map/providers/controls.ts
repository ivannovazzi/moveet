import type { MapControlsContextValue } from "./types";

export let controlsRef: MapControlsContextValue = {
  // Stub: not ready until the real controls are provided (DeckGLMap mounted).
  ready: false,
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  getZoom: () => 0,
  setBounds: () => {},
  focusOn: () => {},
};

export function setMapControlsRef(ref: typeof controlsRef) {
  controlsRef = ref;
}

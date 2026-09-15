import type { MapControlsContextValue } from "./types";

export let controlsRef: MapControlsContextValue = {
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  getZoom: () => 0,
  setBounds: () => {},
  focusOn: () => {},
  setPitch: () => {},
  getPitch: () => 0,
  toggleTilt: () => {},
};

export function setMapControlsRef(ref: typeof controlsRef) {
  controlsRef = ref;
}

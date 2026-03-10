import type { MapControlsContextValue } from "./types";

export let controlsRef: MapControlsContextValue = {
  zoomIn: () => {},
  zoomOut: () => {},
  panTo: () => {},
  setZoom: () => {},
  setBounds: () => {},
  focusOn: () => {},
};

export function setMapControlsRef(ref: typeof controlsRef) {
  controlsRef = ref;
}

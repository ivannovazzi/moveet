/**
 * The "fit the camera to the whole road network" action, published for callers
 * that have no React data context to read the network from — the global
 * keyboard dispatcher (`0`) and the command palette.
 *
 * Same shape as `components/Map/providers/controls.ts`: the camera controls are
 * already a module-level ref because the map owns them and everything else just
 * calls them. Fitting the network needs one extra thing the controls don't
 * have — the network's extent — so the map-controls cluster, which reads both,
 * registers the composed action here while it is mounted.
 */
let fitAction: (() => void) | null = null;

/** Register (or, with `null`, withdraw) the action. Called by `Zoom`. */
export function setFitNetwork(action: (() => void) | null) {
  fitAction = action;
}

/** True once a network is loaded and the cluster is mounted. */
export function canFitNetwork() {
  return fitAction !== null;
}

/** Fit the camera to the network. A no-op while the network is still loading. */
export function fitNetwork() {
  fitAction?.();
}

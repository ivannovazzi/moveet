/**
 * When vehicles render as 3D meshes rather than flat sprites.
 *
 * Top-down, a mesh is just a smaller, harder-to-click sprite: from overhead a
 * car model shows its roof and nothing else, and below about zoom 18 it is held
 * at a 7px floor against the sprite's 24px. Meshes only earn their place once
 * the camera leans over and the sides of a vehicle come into view, or once it
 * is close enough that true scale is legible on its own. So:
 *
 *   meshes when (zoom >= 16 && pitch >= 20) || zoom >= 18, else sprites.
 *
 * The density view below zoom 13 is decided separately (`densityView.ts`) and
 * is unaffected.
 */

/** Zoom from which a pitched camera gets meshes. */
export const MESH_PITCHED_MIN_ZOOM = 16;

/** Pitch, in degrees, the camera must lean by for meshes at the pitched zoom. */
export const MESH_MIN_PITCH_DEG = 20;

/** Zoom from which meshes are drawn even when looking straight down. */
export const MESH_TOP_DOWN_MIN_ZOOM = 18;

/**
 * How far past a threshold the camera has to come back before meshes give way
 * to sprites again. Without it, a wheel tick or a drag resting right on z16 or
 * 20 degrees swaps the whole layer back and forth every frame.
 */
export const MESH_ZOOM_HYSTERESIS = 0.5;
export const MESH_PITCH_HYSTERESIS_DEG = 5;

/**
 * The next render mode, given the current one and the camera.
 *
 * Entering 3D uses the thresholds as stated; leaving it uses them lowered by
 * the hysteresis margins, so a mode only flips once a threshold is clearly
 * crossed. Pure and allocation-free: it runs once per animation frame.
 */
export function nextUse3D(prev: boolean, zoom: number, pitch: number): boolean {
  if (!Number.isFinite(zoom)) return prev;
  const zoomSlack = prev ? MESH_ZOOM_HYSTERESIS : 0;
  const pitchSlack = prev ? MESH_PITCH_HYSTERESIS_DEG : 0;
  const safePitch = Number.isFinite(pitch) ? pitch : 0;
  return (
    zoom >= MESH_TOP_DOWN_MIN_ZOOM - zoomSlack ||
    (zoom >= MESH_PITCHED_MIN_ZOOM - zoomSlack && safePitch >= MESH_MIN_PITCH_DEG - pitchSlack)
  );
}

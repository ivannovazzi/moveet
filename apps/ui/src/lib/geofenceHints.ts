/**
 * Minimum vertices a geofence polygon needs before it can be confirmed.
 *
 * This file used to also hold `drawProgressHint`, the "2 points placed, add 1
 * more" copy for the dock's mode rail. The rail no longer carries prose — it
 * reports the vertex count and lets the Finish button's disabled state say the
 * polygon is still short — so the wording went with it and the rule is all that
 * is left to share.
 */
export const MIN_GEOFENCE_VERTICES = 3;

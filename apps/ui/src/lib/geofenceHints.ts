/** Minimum vertices a geofence polygon needs before it can be confirmed. */
export const MIN_GEOFENCE_VERTICES = 3;

/**
 * Progress copy for an in-progress geofence polygon, shared by the map's mode
 * banner (ModeBanner) and the Geofences side panel so the vertex-count wording
 * and the min-vertex rule live in exactly one place.
 *
 * Returns the "keep adding points" phase while the polygon is still short of
 * MIN_GEOFENCE_VERTICES, or `null` once it has enough — each surface renders its
 * own ready-state affordance (the banner's "press Enter to finish" instructions,
 * the panel's "ready to confirm" / Confirm button).
 */
export function drawProgressHint(vertexCount: number): string | null {
  if (vertexCount >= MIN_GEOFENCE_VERTICES) return null;
  if (vertexCount === 0) return `Click the map to add points — at least ${MIN_GEOFENCE_VERTICES}`;
  const remaining = MIN_GEOFENCE_VERTICES - vertexCount;
  return `${vertexCount} point${vertexCount === 1 ? "" : "s"} — add ${remaining} more`;
}

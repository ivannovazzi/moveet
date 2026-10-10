/** `[west, south, east, north]` in degrees. */
export type Bbox = [number, number, number, number];

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Area of a lon/lat box on the sphere, in km². Exact for a spherical Earth:
 * R² · Δλ · (sin φ₂ − sin φ₁).
 */
export function bboxAreaKm2([w, s, e, n]: Bbox): number {
  const rad = Math.PI / 180;
  return (
    EARTH_RADIUS_KM ** 2 * Math.abs((e - w) * rad) * Math.abs(Math.sin(n * rad) - Math.sin(s * rad))
  );
}

/**
 * Why `bbox` is unusable as a build area, or null when it is fine: every
 * value finite, within lon/lat range, west < east and south < north (no
 * antimeridian crossing), and at most `maxAreaKm2`.
 */
export function bboxProblem(bbox: Bbox, maxAreaKm2: number): string | null {
  const [w, s, e, n] = bbox;
  if (!bbox.every(Number.isFinite)) return "bbox values must be finite numbers";
  if (w < -180 || e > 180 || s < -90 || n > 90) return "bbox is outside lon/lat range";
  if (w >= e) return "bbox west must be less than east";
  if (s >= n) return "bbox south must be less than north";
  const area = bboxAreaKm2(bbox);
  if (area > maxAreaKm2) {
    return `bbox covers ${Math.round(area)} km², over the ${maxAreaKm2} km² limit`;
  }
  return null;
}

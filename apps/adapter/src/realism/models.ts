/** Meters per degree of latitude (mean). Longitude scales by cos(latitude). */
export const METERS_PER_DEG_LAT = 111320;

/**
 * Convert an east/north metric offset at a given latitude into degree offsets.
 * Longitude shrinks by cos(latitude); near the equator (Nairobi) it is ~full.
 */
export function metersToLatLon(
  east: number,
  north: number,
  latitudeDeg: number
): { dLat: number; dLon: number } {
  const dLat = north / METERS_PER_DEG_LAT;
  const cos = Math.cos((latitudeDeg * Math.PI) / 180);
  const dLon = east / (METERS_PER_DEG_LAT * (cos === 0 ? 1e-9 : cos));
  return { dLat, dLon };
}

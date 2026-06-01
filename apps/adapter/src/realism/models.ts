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

/**
 * Advance one axis of a first-order Gauss-Markov (FOGM) error process by `dt`
 * seconds. Steady-state std is `sigma`; `tau` is the correlation time constant.
 *
 *   alpha = exp(-dt/tau)
 *   next  = alpha*prev + sqrt(sigma^2 * (1 - alpha^2)) * gaussian()
 *
 * As tau -> 0 this collapses to white noise; as tau -> inf, to a random walk.
 */
export function gaussMarkovStep(
  prev: number,
  sigma: number,
  tau: number,
  dt: number,
  gaussian: () => number
): number {
  if (tau <= 0) return sigma * gaussian();
  const alpha = Math.exp(-dt / tau);
  const noiseStd = sigma * Math.sqrt(Math.max(0, 1 - alpha * alpha));
  return alpha * prev + noiseStd * gaussian();
}

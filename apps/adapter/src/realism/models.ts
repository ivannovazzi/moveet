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
  // Clamp near the poles where cos→0 (never exactly 0 in floating point).
  const dLon = east / (METERS_PER_DEG_LAT * (Math.abs(cos) < 1e-9 ? 1e-9 : cos));
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

export type ConnState = "connected" | "degraded" | "disconnected";

export interface MarkovRates {
  /** Mean time fully connected before any transition (s). */
  meanConnectedS: number;
  /** Mean time in degraded before transition (s). */
  meanDegradedS: number;
  /** Mean disconnected (outage) duration (s). */
  meanDisconnectedS: number;
  /** Of connected exits, mean time until a *degrade* (vs full drop) (s). */
  degradedFromConnectedS: number;
}

/** Per-tick exit probability for a geometric dwell with mean `meanS`. */
function exitProb(meanS: number, dt: number): number {
  if (meanS <= 0) return 1;
  return Math.min(1, dt / meanS);
}

/**
 * Step the 3-state connectivity Markov chain by `dt` seconds.
 *
 * - connected   -> degraded (rate from degradedFromConnectedS) or disconnected
 *                  (rate from meanConnectedS); else stays connected.
 * - degraded    -> reconnect (connected) or fully drop (disconnected) on exit;
 *                  split 50/50 on exit; else stays degraded.
 * - disconnected-> connected on exit (reacquire); else stays disconnected.
 */
export function markovStep(
  state: ConnState,
  rates: MarkovRates,
  dt: number,
  rng: () => number
): ConnState {
  const r = rng();
  if (state === "connected") {
    // A single draw partitions disjoint exit bands [0,pDrop) and
    // [pDrop, pDrop+pDegrade). Clamped means keep pDrop+pDegrade well under 1.
    const pDrop = exitProb(rates.meanConnectedS, dt);
    const pDegrade = exitProb(rates.degradedFromConnectedS, dt);
    if (r < pDrop) return "disconnected";
    if (r < pDrop + pDegrade) return "degraded";
    return "connected";
  }
  if (state === "degraded") {
    const pExit = exitProb(rates.meanDegradedS, dt);
    if (r < pExit) return r < pExit / 2 ? "connected" : "disconnected";
    return "degraded";
  }
  // disconnected
  const pReconnect = exitProb(rates.meanDisconnectedS, dt);
  return r < pReconnect ? "connected" : "disconnected";
}

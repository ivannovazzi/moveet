/**
 * Small, dependency-free polygon geometry helpers used by the manual-heatzone
 * lasso tool. Coordinates are `[lng, lat]` pairs (deck.gl order). Distances are
 * computed in raw coordinate space — for the lasso's purposes (trimming a dense
 * freehand stroke) planar math on degrees is more than accurate enough.
 */

type Pt = [number, number];

/** Perpendicular distance from point `p` to the line through `a`–`b`. */
function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  // Distance from p to the infinite line a-b via the cross-product magnitude.
  const cross = Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy);
  return cross / Math.sqrt(lenSq);
}

/**
 * Ramer–Douglas–Peucker line simplification. Returns a subset of `points` that
 * approximates the original polyline within `tolerance`, always preserving the
 * first and last points. Runs iteratively (explicit stack) so a very long
 * freehand stroke cannot blow the call stack.
 */
export function simplifyPath(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/** Ensure a polygon ring is explicitly closed (first point repeated at the end). */
export function closeRing(points: Pt[]): Pt[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

/** Absolute polygon area via the shoelace formula. Orientation-independent. */
export function ringArea(points: Pt[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

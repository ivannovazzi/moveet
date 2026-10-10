/**
 * Polygon simplification for the area picker's Geofabrik outlines: the index's
 * boundaries carry ~140k points, far more than a world-scale picker can show.
 */

type Point = [number, number];

/** Squared distance from `p` to the segment `a`..`b`. */
function segmentDistSq(p: Point, a: Point, b: Point): number {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/**
 * Douglas-Peucker on an open or closed line: keeps the first and last point
 * and every point further than `tolerance` (degrees) from the simplified line.
 * Iterative, so a long ring cannot overflow the stack.
 */
export function douglasPeucker(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const tolSq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistSq(points[i], points[first], points[last]);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (index !== -1 && maxSq > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Shoelace area of a ring, in square degrees (unsigned). */
function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum / 2);
}

/**
 * Simplifies a closed ring and rounds it to 3 decimals (~100 m). Returns null
 * when nothing worth drawing is left: fewer than three distinct corners, or an
 * area below the tolerance squared (a speck at this scale).
 */
export function simplifyRing(ring: Point[], tolerance: number): Point[] | null {
  if (ring.length < 4) return null;
  // Split the closed ring in two so both halves keep a far point as an anchor.
  const mid = Math.floor(ring.length / 2);
  const a = douglasPeucker(ring.slice(0, mid + 1), tolerance);
  const b = douglasPeucker(ring.slice(mid), tolerance);
  const out: Point[] = [];
  for (const p of [...a, ...b.slice(1)]) {
    const q: Point = [round3(p[0]), round3(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  if (out.length < 4) return null;
  if (ringArea(out) < tolerance * tolerance) return null;
  return out;
}

/** Simplifies every polygon (outer ring and holes), dropping those that vanish. */
export function simplifyPolygons(polygons: Point[][][], tolerance: number): Point[][][] {
  const out: Point[][][] = [];
  for (const polygon of polygons) {
    const outer = polygon[0] ? simplifyRing(polygon[0], tolerance) : null;
    if (!outer) continue;
    const holes = polygon
      .slice(1)
      .map((hole) => simplifyRing(hole, tolerance))
      .filter((h): h is Point[] => h !== null);
    out.push([outer, ...holes]);
  }
  return out;
}

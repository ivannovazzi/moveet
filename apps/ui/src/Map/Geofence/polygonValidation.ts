/**
 * Returns true if line segment (p1→p2) crosses (p3→p4).
 * Uses strict inequality (t,u in open interval (0,1)) so shared endpoints don't count.
 */
export function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  const d1x = p2[0] - p1[0],
    d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0],
    d2y = p4[1] - p3[1];
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / cross;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * Returns true if any two non-adjacent edges of the polygon cross each other.
 * Adjacent edges (including the closing edge from last→first vertex) are skipped.
 */
export function isSelfIntersecting(vertices: [number, number][]): boolean {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // skip adjacent closing edge
      if (segmentsIntersect(vertices[i], vertices[(i + 1) % n], vertices[j], vertices[(j + 1) % n]))
        return true;
    }
  }
  return false;
}

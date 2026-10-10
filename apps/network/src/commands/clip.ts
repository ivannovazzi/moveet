import fs from "fs";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Bbox } from "../regions.js";

/**
 * Cuts an exported road network to exactly a bbox.
 *
 * `osmium extract --bbox` keeps every way that touches the box whole (its
 * default `complete_ways` strategy), so a network straight out of the export
 * reaches past the area that was asked for, by up to a way's length. This
 * clips each line to the box, splitting it where it leaves and re-enters, and
 * drops points outside, so the built map covers the requested area and no
 * more. Where a road crosses the edge it ends on the edge.
 */

type Point = [number, number];

const inside = ([x, y]: Position, [w, s, e, n]: Bbox): boolean =>
  x >= w && x <= e && y >= s && y <= n;

/**
 * Liang-Barsky: the part of segment `a`..`b` inside the box, or null. Exact
 * at the edges, so a clipped end lies on the box's boundary.
 */
export function clipSegment(a: Position, b: Position, [w, s, e, n]: Bbox): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - w],
    [dx, e - a[0]],
    [-dy, a[1] - s],
    [dy, n - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  const at = (t: number): Point => {
    // The endpoints themselves, untouched, so shared nodes still match exactly.
    if (t === 0) return [a[0], a[1]];
    if (t === 1) return [b[0], b[1]];
    return [Math.min(e, Math.max(w, a[0] + dx * t)), Math.min(n, Math.max(s, a[1] + dy * t))];
  };
  return [at(t0), at(t1)];
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

/** The pieces of a line inside the box (each with two or more points). */
export function clipLine(line: Position[], bbox: Bbox): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  const flush = () => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const clipped = clipSegment(line[i], line[i + 1], bbox);
    if (!clipped) {
      flush();
      continue;
    }
    const [from, to] = clipped;
    const last = current[current.length - 1];
    if (!last || !same(last, from)) {
      flush();
      current.push(from);
    }
    if (!same(from, to)) current.push(to);
    // The segment left the box: the next piece starts fresh.
    if (!same(to, line[i + 1])) flush();
  }
  flush();
  return pieces;
}

function clipGeometry(geometry: Geometry, bbox: Bbox): Geometry | null {
  switch (geometry.type) {
    case "Point":
      return inside(geometry.coordinates, bbox) ? geometry : null;
    case "MultiPoint": {
      const coordinates = geometry.coordinates.filter((p) => inside(p, bbox));
      return coordinates.length ? { type: "MultiPoint", coordinates } : null;
    }
    case "LineString": {
      const pieces = clipLine(geometry.coordinates, bbox);
      if (pieces.length === 0) return null;
      // Untouched lines keep their exact original geometry.
      if (pieces.length === 1 && pieces[0].length === geometry.coordinates.length) {
        const whole = pieces[0].every((p, i) => same(p, geometry.coordinates[i]));
        if (whole) return geometry;
      }
      return pieces.length === 1
        ? { type: "LineString", coordinates: pieces[0] }
        : { type: "MultiLineString", coordinates: pieces };
    }
    case "MultiLineString": {
      const pieces = geometry.coordinates.flatMap((line) => clipLine(line, bbox));
      return pieces.length ? { type: "MultiLineString", coordinates: pieces } : null;
    }
    default:
      // The export asks osmium for lines and points only.
      return null;
  }
}

/**
 * Splits a feature whose line crosses the edge more than once into one
 * LineString feature per piece, so the simulator (which reads LineStrings)
 * keeps every piece.
 */
export function clipFeatures(fc: FeatureCollection, bbox: Bbox): FeatureCollection {
  const features: Feature[] = [];
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const geometry = clipGeometry(feature.geometry, bbox);
    if (!geometry) continue;
    if (geometry.type === "MultiLineString" && feature.geometry.type === "LineString") {
      for (const coordinates of geometry.coordinates) {
        features.push({ ...feature, geometry: { type: "LineString", coordinates } });
      }
    } else {
      features.push(geometry === feature.geometry ? feature : { ...feature, geometry });
    }
  }
  return { ...fc, features };
}

/** Clips a GeoJSON file in place; returns the features before and after. */
export function clipNetworkFile(file: string, bbox: Bbox): { before: number; after: number } {
  const fc = JSON.parse(fs.readFileSync(file, "utf8")) as FeatureCollection;
  const clipped = clipFeatures(fc, bbox);
  fs.writeFileSync(file, JSON.stringify(clipped));
  return { before: fc.features.length, after: clipped.features.length };
}

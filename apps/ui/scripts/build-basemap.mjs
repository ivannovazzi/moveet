#!/usr/bin/env node
// ─── World basemap for the New map area picker ──────────────────────
//
// Builds apps/ui/public/basemap/countries.geojson from Natural Earth's 1:50m
// admin-0 countries (public domain, https://www.naturalearthdata.com):
//
//   curl -fsSLo ne_50m.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
//   node apps/ui/scripts/build-basemap.mjs ne_50m.geojson
//
// Each country keeps only what the picker draws: its name, a label point and
// the zoom its label appears at. Rings are simplified (Douglas-Peucker) and
// rounded to 2 decimals (about 1 km), which keeps the file well under 1 MB
// and gzip-friendly. The output is committed; rerun only to change the data.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOLERANCE = 0.03;
const DECIMALS = 2;
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "basemap",
  "countries.geojson"
);

const input = process.argv[2];
if (!input) {
  console.error("usage: build-basemap.mjs <ne_50m_admin_0_countries.geojson>");
  process.exit(1);
}

function segmentDistSq(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistSq(points[i], points[first], points[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index !== -1 && max > tolerance * tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const f = 10 ** DECIMALS;
const round = (v) => Math.round(v * f) / f;

function simplifyRing(ring) {
  const mid = Math.floor(ring.length / 2);
  const a = douglasPeucker(ring.slice(0, mid + 1), TOLERANCE);
  const b = douglasPeucker(ring.slice(mid), TOLERANCE);
  const out = [];
  for (const p of [...a, ...b.slice(1)]) {
    const q = [round(p[0]), round(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length < 4) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
  return out;
}

function simplifyPolygon(polygon) {
  const outer = simplifyRing(polygon[0]);
  if (!outer) return null;
  return [outer, ...polygon.slice(1).map(simplifyRing).filter(Boolean)];
}

const source = JSON.parse(fs.readFileSync(input, "utf8"));
const features = [];
for (const feature of source.features) {
  const p = feature.properties;
  const g = feature.geometry;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const simplified = polygons.map(simplifyPolygon).filter(Boolean);
  if (simplified.length === 0) continue;
  features.push({
    type: "Feature",
    properties: {
      name: p.NAME,
      label: [round(p.LABEL_X), round(p.LABEL_Y)],
      minZoom: p.MIN_LABEL,
    },
    geometry: { type: "MultiPolygon", coordinates: simplified },
  });
}

const body = JSON.stringify({
  type: "FeatureCollection",
  attribution: "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.",
  features,
});
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${body}\n`);
console.log(`${features.length} countries, ${body.length.toLocaleString()} bytes -> ${OUT}`);

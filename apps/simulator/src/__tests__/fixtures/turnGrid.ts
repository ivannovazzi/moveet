import fs from "fs";
import os from "os";
import path from "path";

/**
 * A 3×3 residential street grid for turn-restriction / turn-penalty tests,
 * shaped like the network CLI output: every block is its own way with a
 * numeric `@id`, and restrictions are Point features at the via node.
 *
 *   (0,0)──(0,1)──(0,2)        row 0 is north, column 0 is west
 *     │      │      │
 *   (1,0)──(1,1)──(1,2)        (1,1) is the centre intersection
 *     │      │      │
 *   (2,0)  (2,1)──(2,2)        (2,0)-(2,1) is deliberately missing
 *
 * Every boundary node also gets a short dead-end spur pointing out of the grid
 * (ids 300+), so grid corners are intersections rather than plain bends and
 * turn penalties apply to them the same way as at the centre.
 */

const LAT0 = -1.28;
const LON0 = 36.8;
const STEP = 0.001;

/** `[lat, lon]` of grid cell (row, col). */
export function gridPos(row: number, col: number): [number, number] {
  return [LAT0 - row * STEP, LON0 + col * STEP];
}

/** Way id of the horizontal block (row, col)-(row, col+1). */
export const rowWay = (row: number, col: number) => 100 + row * 10 + col;
/** Way id of the vertical block (row, col)-(row+1, col). */
export const colWay = (row: number, col: number) => 200 + col * 10 + row;

type Feature = Record<string, unknown>;

function line(id: number, a: [number, number], b: [number, number], extra = {}): Feature {
  return {
    type: "Feature",
    properties: { "@id": id, name: `Way ${id}`, highway: "residential", ...extra },
    geometry: {
      type: "LineString",
      coordinates: [
        [a[1], a[0]],
        [b[1], b[0]],
      ],
    },
  };
}

export function gridFeatures(): Feature[] {
  const features: Feature[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      if (r === 2 && c === 0) continue;
      features.push(line(rowWay(r, c), gridPos(r, c), gridPos(r, c + 1)));
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 2; r++) {
      features.push(line(colWay(r, c), gridPos(r, c), gridPos(r + 1, c)));
    }
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 1) continue;
      const [lat, lon] = gridPos(r, c);
      const dLat = r === 0 ? STEP / 2 : r === 2 ? -STEP / 2 : 0;
      const dLon = r === 1 ? (c === 0 ? -STEP / 2 : STEP / 2) : 0;
      features.push(line(300 + r * 10 + c, [lat, lon], [lat + dLat, lon + dLon]));
    }
  }
  return features;
}

/** A restriction relation as the network CLI emits it. */
export function restriction(
  value: string,
  from: number,
  via: [number, number],
  to: number,
  extra: Record<string, unknown> = {}
): Feature {
  return {
    type: "Feature",
    properties: { type: "restriction", restriction: value, from, to, ...extra },
    geometry: { type: "Point", coordinates: [via[1], via[0]] },
  };
}

/** Writes a FeatureCollection to a temp file and returns its path. */
export function writeTmpNetwork(features: Feature[]): string {
  const tmpPath = path.join(
    os.tmpdir(),
    `turn-grid-${Date.now()}-${Math.random().toString(36).slice(2)}.geojson`
  );
  fs.writeFileSync(tmpPath, JSON.stringify({ type: "FeatureCollection", features }));
  return tmpPath;
}

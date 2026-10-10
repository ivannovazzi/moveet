import fs from "fs";
import os from "os";
import path from "path";
import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import { featureStats } from "../pipeline.js";
import type { Bbox } from "../regions.js";
import { clipFeatures, clipLine, clipNetworkFile, clipSegment } from "./clip.js";

const BOX: Bbox = [0, 0, 10, 10];

describe("clipSegment", () => {
  it("keeps a segment inside the box untouched", () => {
    expect(clipSegment([1, 1], [2, 3], BOX)).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it("cuts a crossing segment at the edge", () => {
    expect(clipSegment([5, 5], [15, 5], BOX)).toEqual([
      [5, 5],
      [10, 5],
    ]);
    expect(clipSegment([-5, -5], [5, 5], BOX)).toEqual([
      [0, 0],
      [5, 5],
    ]);
  });

  it("drops a segment that misses the box", () => {
    expect(clipSegment([11, 0], [20, 5], BOX)).toBeNull();
    expect(clipSegment([-1, 5], [-1, 6], BOX)).toBeNull();
  });
});

describe("clipLine", () => {
  it("splits a line that leaves and re-enters the box", () => {
    const pieces = clipLine(
      [
        [2, 2],
        [2, 12],
        [8, 12],
        [8, 2],
      ],
      BOX
    );
    expect(pieces).toEqual([
      [
        [2, 2],
        [2, 10],
      ],
      [
        [8, 10],
        [8, 2],
      ],
    ]);
  });
});

describe("clipFeatures", () => {
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { "@id": 1, highway: "primary" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-5, 5],
            [5, 5],
            [15, 5],
          ],
        },
      },
      {
        type: "Feature",
        properties: { "@id": 2 },
        geometry: {
          type: "LineString",
          coordinates: [
            [2, 2],
            [2, 12],
            [8, 12],
            [8, 2],
          ],
        },
      },
      {
        type: "Feature",
        properties: { "@id": 3 },
        geometry: {
          type: "LineString",
          coordinates: [
            [20, 20],
            [30, 30],
          ],
        },
      },
      {
        type: "Feature",
        properties: { restriction: "no_left_turn" },
        geometry: { type: "Point", coordinates: [3, 3] },
      },
      {
        type: "Feature",
        properties: { restriction: "no_u_turn" },
        geometry: { type: "Point", coordinates: [30, 3] },
      },
    ],
  };

  it("cuts lines to the box, splits multi-crossings, drops what is outside", () => {
    const out = clipFeatures(fc, BOX);
    expect(out.features.map((f) => f.properties?.["@id"] ?? f.properties?.restriction)).toEqual([
      1,
      2,
      2,
      "no_left_turn",
    ]);
    expect(out.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [
        [0, 5],
        [5, 5],
        [10, 5],
      ],
    });
    // Tags survive the cut.
    expect(out.features[0].properties).toEqual({ "@id": 1, highway: "primary" });
  });

  it("leaves the network's extent within the box", () => {
    const { bbox } = featureStats(clipFeatures(fc, BOX));
    expect(bbox).not.toBeNull();
    const [w, s, e, n] = bbox as Bbox;
    expect(w).toBeGreaterThanOrEqual(BOX[0]);
    expect(s).toBeGreaterThanOrEqual(BOX[1]);
    expect(e).toBeLessThanOrEqual(BOX[2]);
    expect(n).toBeLessThanOrEqual(BOX[3]);
  });

  it("clips a file in place", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-clip-"));
    try {
      const file = path.join(dir, "network.geojson");
      fs.writeFileSync(file, JSON.stringify(fc));
      expect(clipNetworkFile(file, BOX)).toEqual({ before: 5, after: 4 });
      expect(JSON.parse(fs.readFileSync(file, "utf8")).features).toHaveLength(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

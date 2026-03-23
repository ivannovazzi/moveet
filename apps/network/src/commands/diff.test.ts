import { describe, it, expect } from "vitest";
import { diffNetworks } from "./diff.js";
import type { FeatureCollection, Feature } from "geojson";

const makeFC = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

const road = (coords: [number, number][], props = {}): Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: coords },
});

describe("diffNetworks", () => {
  it("reports no changes for identical networks", () => {
    const fc = makeFC([
      road(
        [
          [0, 0],
          [1, 0],
        ],
        { name: "A St" },
      ),
    ]);
    const result = diffNetworks(fc, fc);
    expect(result.identical).toBe(true);
    expect(result.nodesAdded).toBe(0);
    expect(result.nodesRemoved).toBe(0);
    expect(result.edgesAdded).toBe(0);
    expect(result.edgesRemoved).toBe(0);
  });

  it("detects added edges", () => {
    const old = makeFC([
      road([
        [0, 0],
        [1, 0],
      ]),
    ]);
    const next = makeFC([
      road([
        [0, 0],
        [1, 0],
      ]),
      road([
        [1, 0],
        [2, 0],
      ]),
    ]);
    const result = diffNetworks(old, next);
    expect(result.edgesAdded).toBe(1);
    expect(result.identical).toBe(false);
  });

  it("detects removed edges", () => {
    const old = makeFC([
      road([
        [0, 0],
        [1, 0],
      ]),
      road([
        [1, 0],
        [2, 0],
      ]),
    ]);
    const next = makeFC([
      road([
        [0, 0],
        [1, 0],
      ]),
    ]);
    const result = diffNetworks(old, next);
    expect(result.edgesRemoved).toBe(1);
    expect(result.identical).toBe(false);
  });

  it("detects newly restricted one-way", () => {
    const old = makeFC([
      road(
        [
          [0, 0],
          [1, 0],
        ],
        { oneway: "no" },
      ),
    ]);
    const next = makeFC([
      road(
        [
          [0, 0],
          [1, 0],
        ],
        { oneway: "yes" },
      ),
    ]);
    const result = diffNetworks(old, next);
    expect(result.newOneway).toBe(1);
  });

  it("is not identical when only speed limits changed", () => {
    const old = makeFC([
      road(
        [
          [0, 0],
          [1, 0],
        ],
        { maxspeed: "50" },
      ),
    ]);
    const next = makeFC([
      road(
        [
          [0, 0],
          [1, 0],
        ],
        { maxspeed: "80" },
      ),
    ]);
    const result = diffNetworks(old, next);
    expect(result.speedChanges).toBe(1);
    expect(result.identical).toBe(false);
  });
});

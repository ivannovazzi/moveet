import { describe, it, expect } from "vitest";
import { pruneNetwork } from "./prune.js";
import type { FeatureCollection, Feature, LineString } from "geojson";

function makeLine(coords: [number, number][]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

describe("pruneNetwork", () => {
  it("keeps all features when network is fully connected", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([[0, 0], [1, 0]]),
        makeLine([[1, 0], [2, 0]]),
      ],
    };
    const { pruned, removedFeatures } = pruneNetwork(fc);
    expect(pruned.features).toHaveLength(2);
    expect(removedFeatures).toBe(0);
  });

  it("removes a small disconnected island", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        // Large component (3 features)
        makeLine([[0, 0], [1, 0]]),
        makeLine([[1, 0], [2, 0]]),
        makeLine([[2, 0], [3, 0]]),
        // Small disconnected island (1 feature)
        makeLine([[10, 10], [11, 10]]),
      ],
    };
    const { pruned, removedFeatures } = pruneNetwork(fc);
    expect(pruned.features).toHaveLength(3);
    expect(removedFeatures).toBe(1);
  });

  it("keeps the larger component when two exist", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        // Component A: 1 feature, 2 nodes
        makeLine([[0, 0], [1, 0]]),
        // Component B: 2 features, 3 nodes (larger)
        makeLine([[10, 10], [11, 10]]),
        makeLine([[11, 10], [12, 10]]),
      ],
    };
    const { pruned, removedFeatures } = pruneNetwork(fc);
    expect(pruned.features).toHaveLength(2);
    expect(removedFeatures).toBe(1);
    // Verify the kept features are from component B
    const coords = (pruned.features[0] as Feature<LineString>).geometry.coordinates;
    expect(coords[0][0]).toBe(10);
  });

  it("returns zero removals for an empty collection", () => {
    const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
    const { pruned, removedFeatures } = pruneNetwork(fc);
    expect(pruned.features).toHaveLength(0);
    expect(removedFeatures).toBe(0);
  });
});

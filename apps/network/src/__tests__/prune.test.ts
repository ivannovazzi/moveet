import { describe, it, expect } from "vitest";
import { pruneNetwork } from "../commands/prune.js";
import type { FeatureCollection } from "geojson";

describe("prune", () => {
  it("should preserve Point features (POIs) through pruning", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { highway: "primary", name: "Main St" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: { amenity: "fuel", name: "Gas Station" },
          geometry: {
            type: "Point",
            coordinates: [0.5, 0.5],
          },
        },
      ],
    };

    const { pruned } = pruneNetwork(fc);
    const points = pruned.features.filter((f) => f.geometry.type === "Point");
    expect(points).toHaveLength(1);
    expect(points[0].properties?.name).toBe("Gas Station");
  });

  it("should remove disconnected LineString features", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: { highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
            ],
          },
        },
        {
          type: "Feature",
          properties: { highway: "tertiary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [10, 10],
              [11, 11],
            ],
          },
        },
      ],
    };

    const { pruned, removedFeatures } = pruneNetwork(fc);
    const lines = pruned.features.filter(
      (f) => f.geometry.type === "LineString",
    );
    expect(lines).toHaveLength(2);
    expect(removedFeatures).toBe(1);
  });

  it("should keep all features if all are connected", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
            ],
          },
        },
      ],
    };

    const { pruned, removedFeatures } = pruneNetwork(fc);
    expect(pruned.features).toHaveLength(2);
    expect(removedFeatures).toBe(0);
  });
});

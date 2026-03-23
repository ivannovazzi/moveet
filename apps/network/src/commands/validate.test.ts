import { describe, it, expect } from "vitest";
import { analyzeNetwork } from "./validate.js";
import type { FeatureCollection, Feature, LineString } from "geojson";

function makeLine(coords: [number, number][]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

describe("analyzeNetwork", () => {
  it("counts edges from a simple network", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([
          [0, 0],
          [1, 0],
        ]),
        makeLine([
          [1, 0],
          [2, 0],
        ]),
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.totalEdges).toBe(2);
    expect(report.totalNodes).toBeGreaterThanOrEqual(2);
  });

  it("detects disconnected components", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([
          [0, 0],
          [1, 0],
        ]),
        makeLine([
          [10, 10],
          [11, 10],
        ]), // disconnected island
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.connectedComponents).toBe(2);
  });

  it("reports 1 component for a fully connected network", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([
          [0, 0],
          [1, 0],
        ]),
        makeLine([
          [1, 0],
          [1, 1],
        ]),
        makeLine([
          [1, 1],
          [0, 0],
        ]),
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.connectedComponents).toBe(1);
  });

  it("passed=true for a well-connected network", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([
          [0, 0],
          [1, 0],
        ]),
        makeLine([
          [1, 0],
          [1, 1],
        ]),
        makeLine([
          [1, 1],
          [0, 0],
        ]),
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.passed).toBe(true);
  });
});

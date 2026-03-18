import fs from "fs";
import type { FeatureCollection, Feature, LineString } from "geojson";

export interface DiffResult {
  identical: boolean;
  nodesAdded: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
  speedChanges: number;
  newOneway: number;
}

const PRECISION = 6;

function edgeKey(coords: [number, number][]): string {
  const start = coords[0];
  const end = coords[coords.length - 1];
  const a = `${start[0].toFixed(PRECISION)},${start[1].toFixed(PRECISION)}`;
  const b = `${end[0].toFixed(PRECISION)},${end[1].toFixed(PRECISION)}`;
  return [a, b].sort().join("|");
}

function nodeSet(fc: FeatureCollection): Set<string> {
  const nodes = new Set<string>();
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    for (const c of (f as Feature<LineString>).geometry
      .coordinates as [number, number][]) {
      nodes.add(`${c[0].toFixed(PRECISION)},${c[1].toFixed(PRECISION)}`);
    }
  }
  return nodes;
}

function edgeMap(fc: FeatureCollection): Map<string, Record<string, unknown>> {
  const edges = new Map<string, Record<string, unknown>>();
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    const coords = (f as Feature<LineString>).geometry
      .coordinates as [number, number][];
    edges.set(edgeKey(coords), (f.properties ?? {}) as Record<string, unknown>);
  }
  return edges;
}

export function diffNetworks(
  oldFc: FeatureCollection,
  newFc: FeatureCollection
): DiffResult {
  const oldNodes = nodeSet(oldFc);
  const newNodes = nodeSet(newFc);
  const oldEdges = edgeMap(oldFc);
  const newEdges = edgeMap(newFc);

  let nodesAdded = 0,
    nodesRemoved = 0;
  for (const n of newNodes) if (!oldNodes.has(n)) nodesAdded++;
  for (const n of oldNodes) if (!newNodes.has(n)) nodesRemoved++;

  let edgesAdded = 0,
    edgesRemoved = 0,
    speedChanges = 0,
    newOneway = 0;

  for (const [k, props] of newEdges) {
    if (!oldEdges.has(k)) {
      edgesAdded++;
      continue;
    }
    const old = oldEdges.get(k)!;
    if (props["maxspeed"] !== old["maxspeed"]) speedChanges++;
    if (props["oneway"] === "yes" && old["oneway"] !== "yes") newOneway++;
  }
  for (const k of oldEdges.keys()) {
    if (!newEdges.has(k)) edgesRemoved++;
  }

  const identical =
    nodesAdded === 0 &&
    nodesRemoved === 0 &&
    edgesAdded === 0 &&
    edgesRemoved === 0;

  return {
    identical,
    nodesAdded,
    nodesRemoved,
    edgesAdded,
    edgesRemoved,
    speedChanges,
    newOneway,
  };
}

export function diff(oldPath: string, newPath: string): DiffResult {
  const oldFc = JSON.parse(fs.readFileSync(oldPath, "utf8")) as FeatureCollection;
  const newFc = JSON.parse(fs.readFileSync(newPath, "utf8")) as FeatureCollection;
  const result = diffNetworks(oldFc, newFc);

  console.log("\nRoad Network Diff");
  console.log("─".repeat(45));
  console.log(
    `  Nodes        +${result.nodesAdded} added   |   -${result.nodesRemoved} removed`
  );
  console.log(
    `  Edges        +${result.edgesAdded} added   |   -${result.edgesRemoved} removed`
  );
  console.log(`  Speed limits  ${result.speedChanges} changed`);
  console.log(`  New one-way   ${result.newOneway} newly restricted`);
  console.log(`\n  Result: ${result.identical ? "✔  Identical" : "⚡  Changed"}\n`);

  return result;
}

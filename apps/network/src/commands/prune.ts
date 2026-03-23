import fs from "fs";
import type { FeatureCollection, Feature, LineString } from "geojson";

const PRECISION = 6;

function nodeKey(coord: [number, number]): string {
  return `${coord[0].toFixed(PRECISION)},${coord[1].toFixed(PRECISION)}`;
}

/**
 * Remove features that are not part of the largest connected component.
 * Returns the pruned FeatureCollection and stats about what was removed.
 */
export function pruneNetwork(fc: FeatureCollection): {
  pruned: FeatureCollection;
  removedFeatures: number;
  removedNodes: number;
} {
  const adjacency = new Map<string, Set<string>>();

  const addNode = (key: string) => {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };
  const addEdge = (a: string, b: string) => {
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  // Build adjacency from LineString features only
  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = (feature as Feature<LineString>).geometry.coordinates as [
      number,
      number,
    ][];
    for (const coord of coords) addNode(nodeKey(coord));
    for (let i = 0; i < coords.length - 1; i++) {
      addEdge(nodeKey(coords[i]), nodeKey(coords[i + 1]));
    }
  }

  // BFS to find connected components
  const visited = new Set<string>();
  const componentOf = new Map<string, number>();
  const componentSizes: number[] = [];
  let componentId = 0;

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    let size = 0;
    const queue: string[] = [node];
    while (queue.length) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      componentOf.set(curr, componentId);
      size++;
      for (const neighbor of adjacency.get(curr)!) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    componentSizes.push(size);
    componentId++;
  }

  // Find the largest component
  let largestId = 0;
  let largestSize = 0;
  for (let i = 0; i < componentSizes.length; i++) {
    if (componentSizes[i] > largestSize) {
      largestSize = componentSizes[i];
      largestId = i;
    }
  }

  const totalNodesBefore = adjacency.size;

  // Keep features where ALL coordinates belong to the largest component
  const kept: typeof fc.features = [];
  let removedFeatures = 0;

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") {
      kept.push(feature); // keep non-LineString features as-is
      continue;
    }
    const coords = (feature as Feature<LineString>).geometry.coordinates as [
      number,
      number,
    ][];
    const inLargest = coords.every(
      (c) => componentOf.get(nodeKey(c)) === largestId,
    );
    if (inLargest) {
      kept.push(feature);
    } else {
      removedFeatures++;
    }
  }

  // Count remaining nodes
  const remainingNodes = new Set<string>();
  for (const feature of kept) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = (feature as Feature<LineString>).geometry.coordinates as [
      number,
      number,
    ][];
    for (const coord of coords) remainingNodes.add(nodeKey(coord));
  }

  return {
    pruned: { type: "FeatureCollection", features: kept },
    removedFeatures,
    removedNodes: totalNodesBefore - remainingNodes.size,
  };
}

export function prune(inputPath: string, outputPath?: string): void {
  const raw = fs.readFileSync(inputPath, "utf8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const originalCount = fc.features.length;

  const { pruned, removedFeatures, removedNodes } = pruneNetwork(fc);

  const dest = outputPath ?? inputPath;
  fs.writeFileSync(dest, JSON.stringify(pruned));

  console.log(
    `\nPrune: removed ${removedFeatures.toLocaleString()} features, ${removedNodes.toLocaleString()} nodes`,
  );
  console.log(
    `  ${originalCount.toLocaleString()} → ${pruned.features.length.toLocaleString()} features`,
  );
}

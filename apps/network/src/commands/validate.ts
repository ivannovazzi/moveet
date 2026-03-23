import fs from "fs";
import type { FeatureCollection, Feature, LineString } from "geojson";

export interface ValidationReport {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  largestComponentPct: number;
  isolatedNodes: number;
  passed: boolean;
}

const PRECISION = 6;

function nodeKey(coord: [number, number]): string {
  return `${coord[0].toFixed(PRECISION)},${coord[1].toFixed(PRECISION)}`;
}

export function analyzeNetwork(fc: FeatureCollection): ValidationReport {
  const adjacency = new Map<string, Set<string>>();

  const addNode = (key: string) => {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };

  const addEdge = (a: string, b: string) => {
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  let totalEdges = 0;

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = (feature as Feature<LineString>).geometry.coordinates as [
      number,
      number,
    ][];
    totalEdges++;
    for (const coord of coords) addNode(nodeKey(coord));
    for (let i = 0; i < coords.length - 1; i++) {
      addEdge(nodeKey(coords[i]), nodeKey(coords[i + 1]));
    }
  }

  const visited = new Set<string>();
  const components: number[] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    let size = 0;
    const queue: string[] = [node];
    while (queue.length) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      size++;
      for (const neighbor of adjacency.get(curr)!) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(size);
  }

  components.sort((a, b) => b - a);
  const totalNodes = adjacency.size;
  const isolatedNodes = components.filter((s) => s === 1).length;
  const largestComponentPct =
    totalNodes > 0 ? (components[0] / totalNodes) * 100 : 0;

  return {
    totalNodes,
    totalEdges,
    connectedComponents: components.length,
    largestComponentPct: Math.round(largestComponentPct * 10) / 10,
    isolatedNodes,
    // Pass if ≥95% of nodes are in the largest component and <5% are isolated.
    // Real-world city exports always have some small disconnected fragments at
    // bbox boundaries; a strict component count would reject valid networks.
    passed:
      largestComponentPct >= 95 &&
      isolatedNodes / Math.max(totalNodes, 1) < 0.05,
  };
}

export function validate(inputPath: string): ValidationReport {
  const raw = fs.readFileSync(inputPath, "utf8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const report = analyzeNetwork(fc);

  console.log("\nTopology Validation Report");
  console.log("─".repeat(40));
  console.log(`  Nodes:                ${report.totalNodes.toLocaleString()}`);
  console.log(`  Edges:                ${report.totalEdges.toLocaleString()}`);
  console.log(
    `  Connected components: ${report.connectedComponents} ${report.connectedComponents > 3 ? "⚠️" : "✔"}`,
  );
  console.log(
    `  Largest component:    ${report.largestComponentPct}% of nodes`,
  );
  console.log(
    `  Isolated nodes:       ${report.isolatedNodes} ${report.isolatedNodes > 0 ? "⚠️" : "✔"}`,
  );
  console.log(`\n  Result: ${report.passed ? "✔  PASSED" : "✗  FAILED"}\n`);

  return report;
}

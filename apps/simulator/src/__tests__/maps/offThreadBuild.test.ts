/**
 * The off-thread graph build (map switch) must produce exactly the graph the
 * synchronous constructor builds: same Map key orders, same object shapes,
 * same sharing between nodes, edges, roads and features, same derived indexes.
 * It must also fail cleanly (reject, nothing half-built) on a malformed file
 * or a worker that dies.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { RoadNetwork } from "../../modules/RoadNetwork";
import { GraphBuilder } from "../../modules/roadnetwork/GraphBuilder";
import { packGraph, unpackGraph } from "../../modules/roadnetwork/packedGraph";
import { buildGraphOffThread } from "../../modules/roadnetwork/buildOffThread";
import { runSliced, runToEnd } from "../../utils/sliced";
import type { Edge, Node } from "../../types";
import { gridFeatures, gridPos, restriction, rowWay, colWay } from "../fixtures/turnGrid";

const FIXTURES = path.join(__dirname, "..", "fixtures");
const BUNDLED = path.join(__dirname, "..", "..", "..", "assets", "default-map", "network.geojson");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-offthread-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function writeTmp(name: string, content: string): string {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, content);
  return file;
}

/**
 * A network exercising every builder branch the packing has to carry: one-way
 * and roundabout ways, an access-restricted way, a duplicated way (repeated
 * edge ids), English names, maxspeed / lanes / smoothness / way-level traffic
 * calming, signals on and next to a vertex, stop and crossing controls, turn
 * restrictions, POIs, and an extra top-level member on the collection.
 */
function richNetworkPath(): string {
  const features: Array<Record<string, unknown>> = gridFeatures();
  const line = (id: number, coords: Array<[number, number]>, props: Record<string, unknown>) => ({
    type: "Feature",
    properties: { "@id": id, highway: "secondary", ...props },
    geometry: { type: "LineString", coordinates: coords.map(([lat, lon]) => [lon, lat]) },
  });
  const point = (lat: number, lon: number, props: Record<string, unknown>) => ({
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: [lon, lat] },
  });
  const [aLat, aLon] = gridPos(0, 0);
  const [bLat, bLon] = gridPos(0, 2);
  features.push(
    line(900, [gridPos(0, 0), [aLat + 0.001, aLon + 0.001], gridPos(0, 1)], {
      name: "Via Roma",
      "name:en": "Rome Street",
      oneway: "yes",
      maxspeed: "40",
      lanes: "2",
      smoothness: "bad",
      surface: "asphalt",
    }),
    line(901, [gridPos(1, 1), [bLat + 0.002, bLon], gridPos(1, 2)], {
      name: "Circle",
      junction: "roundabout",
      traffic_calming: "chicane",
    }),
    line(902, [gridPos(2, 1), [bLat - 0.003, bLon + 0.001]], {
      name: "Private Lane",
      access: "private",
    }),
    // Same geometry as an existing grid block: repeated edge ids.
    line(903, [gridPos(1, 0), gridPos(1, 1)], { name: "Duplicate", oneway: "-1" }),
    line(904, [gridPos(2, 2), [bLat - 0.004, bLon + 0.002]], { name: "Via Roma" }),
    point(...gridPos(1, 1), { highway: "traffic_signals" }),
    // About 5 m off the (0,1) vertex: resolved by the snap grid.
    point(gridPos(0, 1)[0] + 0.00004, gridPos(0, 1)[1], { highway: "traffic_signals;crossing" }),
    point(...gridPos(1, 2), { highway: "stop" }),
    point(...gridPos(0, 2), { highway: "give_way" }),
    point(aLat + 0.0003, aLon + 0.0002, { id: "poi-1", amenity: "cafe", name: "Bar" }),
    point(aLat - 0.0004, aLon + 0.0001, { id: "poi-2", shop: "bakery" }),
    point(aLat - 0.0005, aLon + 0.0003, { id: "poi-3", highway: "bus_stop" }),
    restriction("no_left_turn", rowWay(1, 0), gridPos(1, 1), colWay(0, 1)),
    restriction("only_straight_on", colWay(0, 2), gridPos(1, 2), colWay(1, 2))
  );
  return writeTmp(
    "rich.geojson",
    JSON.stringify({ type: "FeatureCollection", name: "rich", features })
  );
}

/**
 * Everything a RoadNetwork holds, flattened into plain data. Object identity
 * becomes an ordinal (edges in discovery order), so two graphs compare equal
 * only when they share structure the same way, and key order is recorded.
 */
function describeNetwork(network: RoadNetwork) {
  const n = network as unknown as Record<string, any>;
  const nodes = n.nodes as Map<string, Node>;
  const edges = n.edges as Map<string, Edge>;
  const engine = n.pathfinding as Record<string, any>;
  const spatial = n.spatial as Record<string, any>;
  // Index the engine the way every caller eventually does.
  void network.edgeCount;

  const edgeOrdinal = new Map<Edge, number>();
  const edgeObjects: Edge[] = [];
  const ord = (edge: Edge) => {
    let i = edgeOrdinal.get(edge);
    if (i === undefined) {
      i = edgeObjects.length;
      edgeObjects.push(edge);
      edgeOrdinal.set(edge, i);
    }
    return i;
  };
  const nodeDesc = [...nodes].map(([key, node]) => ({
    key,
    keys: Object.keys(node),
    ...node,
    connections: node.connections.map(ord),
  }));
  const edgeMap = [...edges].map(([key, edge]) => [key, ord(edge)]);
  const edgeDesc = edgeObjects.map((edge) => ({
    keys: Object.keys(edge),
    ...edge,
    start: edge.start.id,
    end: edge.end.id,
    startIsNode: nodes.get(edge.start.id) === edge.start,
    endIsNode: nodes.get(edge.end.id) === edge.end,
  }));

  const features = network.getFeatures();
  const featureOfCoords = new Map<unknown, number>();
  features.features.forEach((f, i) => {
    featureOfCoords.set((f.geometry as any).coordinates, i);
  });
  const roadObjects: unknown[] = [];
  const roads = [...(n.roads as Map<string, any>)].map(([key, road]) => {
    if (!roadObjects.includes(road)) roadObjects.push(road);
    return {
      key,
      object: roadObjects.indexOf(road),
      keys: Object.keys(road),
      name: road.name,
      nameEn: road.nameEn,
      nodeIds: [...road.nodeIds],
      streets: road.streets.map((s: unknown) => featureOfCoords.get(s) ?? -1),
    };
  });

  return {
    nodes: nodeDesc,
    edgeMap,
    edges: edgeDesc,
    edgeBaseCost: [...(engine.edgeBaseCost as Map<string, number>)],
    connectedEdges: [...(engine.connectedEdges as Map<string, Edge[]>)].map(([k, v]) => [
      k,
      v.map(ord),
    ]),
    turnBans: [...(engine.turnBans as Map<string, Set<string>>)].map(([k, v]) => [k, [...v]]),
    maxNetworkSpeed: engine.maxNetworkSpeed,
    landmarks: engine.alt ? engine.alt.index : null,
    searchEdges: (engine.searchEdges as Edge[]).map(ord),
    searchBaseCost: [...(engine.searchBaseCost as Float64Array)],
    roads,
    pois: network.getAllPOIs(),
    speedLimits: network.getSpeedLimits(),
    featureKeys: Object.keys(features),
    features,
    bbox: network.getBoundingBox(),
    grid: [...(spatial.spatialGrid as Map<string, Node[]>)].map(([k, v]) => [
      k,
      v.map((node) => node.id),
    ]),
    sectorEdges: (spatial.sectorEdges as Edge[][]).map((b) => b.map(ord)),
    sectorNodes: (spatial.sectorNodes as Node[][]).map((b) => b.map((node) => node.id)),
    poiNodes: network.getPOINodes().map((node) => [node.id, nodes.get(node.id) === node]),
    nodeCount: network.nodeCount,
    edgeCount: network.edgeCount,
  };
}

const fixtures: Array<[string, () => string]> = [
  ["rich synthetic network", richNetworkPath],
  ["test-network fixture", () => path.join(FIXTURES, "test-network.geojson")],
  ["integration-network fixture", () => path.join(FIXTURES, "integration-network.geojson")],
  ["bundled default map", () => BUNDLED],
];

describe("off-thread graph build", () => {
  for (const [label, file] of fixtures) {
    it(`equals the main-thread build: ${label}`, async () => {
      const p = file();
      const expected = new RoadNetwork(p);
      const actual = await RoadNetwork.loadOffThread(p);
      expect(actual.edgeCount).toBeGreaterThan(0);
      expect(describeNetwork(actual)).toEqual(describeNetwork(expected));
    });
  }

  it("equals the main-thread build with landmarks off and speed profiles on", async () => {
    const p = richNetworkPath();
    const options = { landmarkCount: 0, speedProfileRatio: 1.3 };
    const expected = new RoadNetwork(p, options);
    const actual = await RoadNetwork.loadOffThread(p, options);
    expect(describeNetwork(actual)).toEqual(describeNetwork(expected));
  });

  it("covers the branches it claims to (sanity check on the rich fixture)", () => {
    const network = new RoadNetwork(richNetworkPath());
    const nodes = [...(network as unknown as { nodes: Map<string, Node> }).nodes.values()];
    expect(nodes.filter((node) => node.trafficSignal).length).toBeGreaterThanOrEqual(2);
    const all = nodes.flatMap((node) => node.connections);
    expect(new Set(all.map((e) => e.id)).size).toBeLessThan(all.length); // repeated ids
    expect(all.some((e) => e.nodeDelayH !== undefined)).toBe(true);
    expect(network.getTurnBans().size).toBeGreaterThan(0);
    expect(network.getAllPOIs().length).toBe(3);
    expect(network.getSpeedLimits().length).toBeGreaterThan(0);
    expect((network.getFeatures() as FeatureCollection & { name?: string }).name).toBe("rich");
  });

  it("packing round-trips through structured clone, sliced or not", async () => {
    const p = richNetworkPath();
    const read = () => JSON.parse(fs.readFileSync(p, "utf8")) as FeatureCollection;
    const reference = new GraphBuilder().build(read());
    const { graph, lists } = packGraph(new GraphBuilder().build(read()));
    const cloned = structuredClone({ graph, lists });
    const sync = runToEnd(unpackGraph(cloned.graph, cloned.lists));
    const sliced = await runSliced(unpackGraph(cloned.graph, structuredClone(lists)), 0);
    for (const built of [sync, sliced]) {
      expect([...built.nodes.keys()]).toEqual([...reference.nodes.keys()]);
      expect([...built.edges.keys()]).toEqual([...reference.edges.keys()]);
      expect([...built.roads.keys()]).toEqual([...reference.roads.keys()]);
      expect(built.lineStringFeatures).toEqual(reference.lineStringFeatures);
      expect(built.landmarks).toEqual(reference.landmarks);
    }
  });

  it("rejects lists that do not match the graph", () => {
    const p = richNetworkPath();
    const { graph, lists } = packGraph(
      new GraphBuilder().build(JSON.parse(fs.readFileSync(p, "utf8")) as FeatureCollection)
    );
    expect(() => runToEnd(unpackGraph(graph, { ...lists, pois: lists.pois.slice(1) }))).toThrow(
      /Expected 3 pois, got 2/
    );
  });

  it("rejects a malformed file", async () => {
    const p = writeTmp("broken.geojson", "{ not json");
    await expect(RoadNetwork.loadOffThread(p)).rejects.toThrow(/JSON/);
  });

  it("rejects a missing file", async () => {
    await expect(RoadNetwork.loadOffThread(path.join(tmpRoot, "nope.geojson"))).rejects.toThrow(
      /ENOENT/
    );
  });

  it("rejects when the worker exits early", async () => {
    const workerPath = writeTmp("exits.cjs", "process.exit(3);\n");
    await expect(
      buildGraphOffThread(
        {
          geojsonPath: BUNDLED,
          landmarkCount: 0,
          freeFlowFactors: {} as never,
          speedProfileRatio: null,
        },
        { workerPath }
      )
    ).rejects.toThrow(/exited with code 3/);
  });

  it("rejects when the worker throws", async () => {
    const workerPath = writeTmp("throws.cjs", 'throw new Error("worker blew up");\n');
    await expect(RoadNetwork.loadOffThread(BUNDLED, undefined, { workerPath })).rejects.toThrow(
      /worker blew up/
    );
  });
});

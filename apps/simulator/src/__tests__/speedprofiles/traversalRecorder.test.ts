import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "fs";
import { TraversalRecorder } from "../../modules/speedprofiles/TraversalRecorder";
import { RouteManager } from "../../modules/RouteManager";
import { VehicleRegistry } from "../../modules/VehicleRegistry";
import { TrafficManager } from "../../modules/TrafficManager";
import { FleetManager } from "../../modules/FleetManager";
import { RoadNetwork } from "../../modules/RoadNetwork";
import type { Edge, StartOptions, Vehicle } from "../../types";
import { gridFeatures, gridPos, writeTmpNetwork } from "../fixtures/turnGrid";

vi.mock("../../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const tmpFiles: string[] = [];
afterAll(() => {
  for (const f of tmpFiles) fs.rmSync(f, { force: true });
});

const OPTIONS: StartOptions = {
  updateInterval: 100,
  minSpeed: 5,
  maxSpeed: 60,
  speedVariation: 0,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 30,
  heatZoneSpeedFactor: 0.5,
  adapterSyncInterval: 1000,
};

function edge(id: string, bearing: number, distance = 0.1): Edge {
  return { id, bearing, distance } as unknown as Edge;
}

function vehicleOn(e: Edge): Vehicle {
  return { id: "v", currentEdge: e, progress: 0, speed: 36 } as unknown as Vehicle;
}

describe("TraversalRecorder", () => {
  it("records the running speed of an edge entered and left straight on", () => {
    const sink = vi.fn();
    const rec = new TraversalRecorder(sink);
    const a = edge("a", 90);
    const b = edge("b", 95, 0.2);
    const c = edge("c", 85);
    const v = vehicleOn(a);

    rec.enter(v, a, b, 30);
    v.currentEdge = b;
    rec.accrue(v, 10_000);
    rec.exit(v, 10_000, c, 30); // 0.2 km in 20 s = 36 km/h
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe(b);
    expect(sink.mock.calls[0][1]).toBeCloseTo(36, 9);
  });

  it("skips an edge entered through a turn", () => {
    const sink = vi.fn();
    const rec = new TraversalRecorder(sink);
    const a = edge("a", 0);
    const b = edge("b", 90);
    const v = vehicleOn(a);
    rec.enter(v, a, b, 30);
    v.currentEdge = b;
    rec.exit(v, 5_000, edge("c", 90), 30);
    expect(sink).not.toHaveBeenCalled();
  });

  it("skips an edge left through a turn or at the end of a route", () => {
    const sink = vi.fn();
    const rec = new TraversalRecorder(sink);
    const a = edge("a", 90);
    const b = edge("b", 90);
    const v = vehicleOn(a);
    rec.enter(v, a, b, 30);
    v.currentEdge = b;
    rec.exit(v, 5_000, edge("c", 180), 30);
    rec.enter(v, a, b, 30);
    rec.exit(v, 5_000, null, 30);
    expect(sink).not.toHaveBeenCalled();
  });

  it("forgets a vehicle moved onto another edge without a transition", () => {
    const sink = vi.fn();
    const rec = new TraversalRecorder(sink);
    const a = edge("a", 90);
    const b = edge("b", 90);
    const v = vehicleOn(a);
    rec.enter(v, a, b, 30);
    v.currentEdge = edge("teleported", 90); // e.g. findAndSetRoutes
    rec.accrue(v, 1_000);
    rec.exit(v, 1_000, edge("c", 90), 30);
    expect(sink).not.toHaveBeenCalled();
  });

  it("does not record a vehicle it never saw enter an edge", () => {
    const sink = vi.fn();
    const rec = new TraversalRecorder(sink);
    const v = vehicleOn(edge("a", 90));
    rec.accrue(v, 1_000);
    rec.exit(v, 1_000, edge("b", 90), 30);
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("RouteManager feeds the traversal recorder", () => {
  it("records only fully-driven straight-through edges, at the driven speed", () => {
    const file = writeTmpNetwork(gridFeatures());
    tmpFiles.push(file);
    const network = new RoadNetwork(file, { landmarkCount: 0 });
    const registry = new VehicleRegistry(network, new FleetManager());
    const routeManager = new RouteManager(network, registry, new TrafficManager());
    const sink = vi.fn();
    routeManager.setTraversalRecorder(new TraversalRecorder(sink));

    // Row 1 west spur -> (1,0) -> (1,1) -> (1,2) -> east spur: a straight line.
    const [lat, lon] = gridPos(1, 0);
    const spurWest = network.findNearestNode([lat, lon - 0.0005]);
    const n10 = network.findNearestNode(gridPos(1, 0));
    const n11 = network.findNearestNode(gridPos(1, 1));
    const n12 = network.findNearestNode(gridPos(1, 2));
    const e0 = spurWest.connections.find((e) => e.end === n10)!;
    const route = network.findRoute(spurWest, n12)!;
    const [lat2, lon2] = gridPos(1, 2);
    const spurEast = network.findNearestNode([lat2, lon2 + 0.0005]);
    const last = n12.connections.find((e) => e.end === spurEast)!;
    const edges = [...route.edges, last];
    expect(edges[0]).toBe(e0);
    expect(edges.map((e) => e.end)).toEqual([n10, n11, n12, spurEast]);

    const vehicle = {
      id: "v1",
      name: "v1",
      type: "car",
      currentEdge: e0,
      position: e0.start.coordinates,
      speed: 36,
      bearing: e0.bearing,
      progress: 0,
      edgeIndex: 0,
    } as Vehicle;
    routeManager.setRoute(vehicle.id, { edges, distance: 0 });
    for (let i = 0; i < 1000 && routeManager.getRoute(vehicle.id); i++) {
      vehicle.speed = 36;
      routeManager.updatePositionCore(vehicle, 100, OPTIONS, routeManager.getRoute(vehicle.id));
    }

    const recorded = sink.mock.calls.map(([e]) => e as Edge);
    expect(recorded).toEqual([edges[1], edges[2]]);
    for (const [, speed] of sink.mock.calls) expect(speed).toBeCloseTo(36, 6);
  });
});

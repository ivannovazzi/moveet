import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import { RouteManager } from "../modules/RouteManager";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { TrafficManager } from "../modules/TrafficManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Route, Vehicle } from "../types";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

/**
 * fleetsim-all-1ajn.11 / .12 at the RouteManager seam: the ETA a client sees
 * comes from the cached route pricing, tracks the vehicle along the route, and
 * ignores `vehicle.speed`.
 */
describe("RouteManager ETA", () => {
  let network: RoadNetwork;
  let registry: VehicleRegistry;
  let routeManager: RouteManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 3;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);
    registry = new VehicleRegistry(network, new FleetManager());
    routeManager = new RouteManager(network, registry, new TrafficManager());
    routeManager.getClockHour = () => 12;
    registry.loadFromData();
  });

  afterEach(() => {
    network.setWeatherFactor(1);
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
  });

  function firstVehicle(): Vehicle {
    return registry.getAll().values().next().value!;
  }

  /** A short route made of real network edges, starting at the vehicle's current edge. */
  function routeFrom(vehicle: Vehicle, count = 3): Route {
    const edges = [vehicle.currentEdge];
    let node = vehicle.currentEdge.end;
    while (edges.length < count) {
      const next = node.connections.find((e) => e.id !== edges[edges.length - 1].id);
      if (!next) break;
      edges.push(next);
      node = next.end;
    }
    return { edges, distance: edges.reduce((sum, e) => sum + e.distance, 0) };
  }

  it("has no ETA for a vehicle with no route", () => {
    expect(routeManager.etaSecondsFor(firstVehicle())).toBeUndefined();
    expect(routeManager.remainingKmFor(firstVehicle())).toBeUndefined();
  });

  it("prices a route on assignment and reports a positive ETA", () => {
    const vehicle = firstVehicle();
    const route = routeFrom(vehicle);
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    routeManager.setRoute(vehicle.id, route);

    const eta = routeManager.etaSecondsFor(vehicle)!;
    expect(eta).toBeGreaterThan(0);
    expect(Number.isFinite(eta)).toBe(true);
    expect(routeManager.remainingKmFor(vehicle)).toBeCloseTo(route.distance, 6);
  });

  it("does not change the ETA when the vehicle's instantaneous speed changes", () => {
    // The bug this replaced: `estimateRouteDuration(route, vehicle.speed)` made
    // the ETA a reciprocal of the speedometer, so a turn slowdown multiplied it.
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    vehicle.speed = 60;
    const atSpeed = routeManager.etaSecondsFor(vehicle);
    vehicle.speed = 3;
    const crawling = routeManager.etaSecondsFor(vehicle);
    vehicle.speed = 0;
    const stopped = routeManager.etaSecondsFor(vehicle);

    expect(crawling).toBe(atSpeed);
    expect(stopped).toBe(atSpeed);
  });

  it("falls as the vehicle advances along the route", () => {
    const vehicle = firstVehicle();
    const route = routeFrom(vehicle);
    routeManager.setRoute(vehicle.id, route);

    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    const start = routeManager.etaSecondsFor(vehicle)!;
    vehicle.progress = 0.9;
    const nearEndOfFirst = routeManager.etaSecondsFor(vehicle)!;
    vehicle.edgeIndex = route.edges.length - 1;
    vehicle.progress = 0.9;
    const nearlyThere = routeManager.etaSecondsFor(vehicle)!;

    expect(nearEndOfFirst).toBeLessThan(start);
    expect(nearlyThere).toBeLessThan(nearEndOfFirst);
  });

  it("resolves the route position when the vehicle has not been placed on an edge yet", () => {
    // Between assignment and the first tick `edgeIndex` is -1; the ETA still
    // resolves by locating the vehicle's current edge on the route.
    const vehicle = firstVehicle();
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));
    vehicle.edgeIndex = -1;
    vehicle.progress = 0;
    expect(routeManager.etaSecondsFor(vehicle)).toBeGreaterThan(0);
  });

  it("exposes a breakdown whose parts sum to the route ETA", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const breakdown = routeManager.etaBreakdownFor(vehicle.id)!;
    const total = routeManager.etaSecondsFor(vehicle)!;
    expect(
      breakdown.drivingSeconds + breakdown.nodeDelaySeconds + breakdown.turnSeconds
    ).toBeCloseTo(total, 6);
    expect(breakdown.weatherFactor).toBe(1);
    expect(breakdown.learnedDistanceShare).toBeGreaterThanOrEqual(0);
    expect(breakdown.learnedDistanceShare).toBeLessThanOrEqual(1);
  });

  it("reprices when the weather factor moves under an assigned route", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const dry = routeManager.etaSecondsFor(vehicle)!;
    network.setWeatherFactor(0.5);
    const wet = routeManager.etaSecondsFor(vehicle)!;

    expect(wet).toBeGreaterThan(dry);
    expect(routeManager.etaBreakdownFor(vehicle.id)!.weatherFactor).toBe(0.5);
  });

  it("drops the pricing with the route", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));
    routeManager.deleteRoute(vehicle.id);
    expect(routeManager.etaSecondsFor(vehicle)).toBeUndefined();
    expect(routeManager.etaBreakdownFor(vehicle.id)).toBeUndefined();
  });

  it("drops all pricing on reset", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));
    routeManager.reset();
    expect(routeManager.etaSecondsFor(vehicle)).toBeUndefined();
  });

  it("reports every routed vehicle's whole-route ETA for a reprice broadcast", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0.5;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const [update] = routeManager.getEtaUpdates();
    expect(update.vehicleId).toBe(vehicle.id);
    // The WHOLE route, not the remainder: this corrects the composition a
    // client shows for the trip, which the live per-tick ETA sits under.
    expect(update.eta).toBeGreaterThan(routeManager.etaSecondsFor(vehicle)!);
    expect(update.etaBreakdown).toEqual(routeManager.etaBreakdownFor(vehicle.id));
  });

  it("reprices the ETA updates at the current weather factor", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));
    const [dry] = routeManager.getEtaUpdates();

    network.setWeatherFactor(0.5);
    const [wet] = routeManager.getEtaUpdates();

    expect(wet.eta).toBeGreaterThan(dry.eta);
    expect(wet.etaBreakdown.weatherFactor).toBe(0.5);
  });

  it("reports nothing when no vehicle has a route", () => {
    expect(routeManager.getEtaUpdates()).toEqual([]);
  });

  it("puts the remaining ETA and its breakdown on the directions snapshot", () => {
    const vehicle = firstVehicle();
    vehicle.edgeIndex = 0;
    vehicle.progress = 0;
    routeManager.setRoute(vehicle.id, routeFrom(vehicle));

    const [direction] = routeManager.getDirections();
    expect(direction.vehicleId).toBe(vehicle.id);
    expect(direction.eta).toBeCloseTo(routeManager.etaSecondsFor(vehicle)!, 6);
    expect(direction.etaBreakdown).toBeDefined();
  });
});

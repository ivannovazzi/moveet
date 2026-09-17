import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RouteManager, UNROUTED_LOG_SAMPLE_RATE } from "../modules/RouteManager";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { TrafficManager } from "../modules/TrafficManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle, Route, StartOptions } from "../types";
import path from "path";
import logger from "../utils/logger";
import * as metrics from "../metrics";
import { getProfile } from "../utils/vehicleProfiles";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

const DEFAULT_OPTIONS: StartOptions = {
  updateInterval: 500,
  minSpeed: 20,
  maxSpeed: 60,
  speedVariation: 0,
  acceleration: 5,
  deceleration: 7,
  turnThreshold: 45,
  heatZoneSpeedFactor: 0.5,
  adapterSyncInterval: 1000,
};

describe("RouteManager", () => {
  let network: RoadNetwork;
  let registry: VehicleRegistry;
  let traffic: TrafficManager;
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
    traffic = new TrafficManager();
    routeManager = new RouteManager(network, registry, traffic);
    routeManager.getClockHour = () => 12; // midday

    // Load vehicles without triggering setRandomDestination
    registry.loadFromData();
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
  });

  function firstVehicle(): Vehicle {
    return registry.getAll().values().next().value!;
  }

  // ─── Route CRUD ───────────────────────────────────────────────────

  describe("route CRUD", () => {
    it("should set and get a route", () => {
      const route: Route = { edges: [], distance: 0 };
      routeManager.setRoute("v1", route);
      expect(routeManager.getRoute("v1")).toBe(route);
    });

    it("should delete a route", () => {
      routeManager.setRoute("v1", { edges: [], distance: 0 });
      routeManager.deleteRoute("v1");
      expect(routeManager.getRoute("v1")).toBeUndefined();
    });
  });

  // ─── peekNextEdge ─────────────────────────────────────────────────

  describe("peekNextEdge", () => {
    it("should return a connected edge without modifying visited edges", () => {
      const vehicle = firstVehicle();
      const nextEdge = routeManager.peekNextEdge(vehicle);
      expect(nextEdge).toBeDefined();
      expect(nextEdge.id).toBeDefined();
    });

    it("should return reversed edge when no connections exist", () => {
      const vehicle = firstVehicle();
      // Mock getConnectedEdges to return empty
      vi.spyOn(network, "getConnectedEdges").mockReturnValue([]);
      const nextEdge = routeManager.peekNextEdge(vehicle);
      // Should be a reversed version of the current edge
      expect(nextEdge.bearing).toBe((vehicle.currentEdge.bearing + 180) % 360);
      vi.restoreAllMocks();
    });

    it("should follow the assigned route's next edge, not an arbitrary connected edge", () => {
      const vehicle = firstVehicle();
      // Synthetic next edge with a unique id that cannot come from the
      // connected-edge fallback, so we can prove the route was consulted.
      const routeNext = { ...vehicle.currentEdge, id: "route-next-edge" };
      routeManager.setRoute(vehicle.id, {
        edges: [vehicle.currentEdge, routeNext],
        distance: 1,
      });
      vehicle.edgeIndex = 0;

      const nextEdge = routeManager.peekNextEdge(vehicle);
      expect(nextEdge.id).toBe("route-next-edge");
    });
  });

  // ─── getNextEdge ──────────────────────────────────────────────────

  describe("getNextEdge", () => {
    it("should return a valid next edge", () => {
      const vehicle = firstVehicle();
      const nextEdge = routeManager.getNextEdge(vehicle);
      expect(nextEdge).toBeDefined();
      expect(nextEdge.start).toBeDefined();
      expect(nextEdge.end).toBeDefined();
    });
  });

  // ─── updateSpeed ──────────────────────────────────────────────────

  describe("updateSpeed", () => {
    it("should clamp speed to effectiveMax", () => {
      const vehicle = firstVehicle();
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;

      routeManager.updateSpeed(vehicle, 1000, {
        ...DEFAULT_OPTIONS,
        maxSpeed: 999,
        minSpeed: 1,
      });

      expect(vehicle.speed).toBeLessThanOrEqual(vehicle.currentEdge.maxSpeed);
    });

    it("caps movement at the edge's free-flow speed so it matches the routing cost", () => {
      const vehicle = firstVehicle();
      vehicle.currentEdge = { ...vehicle.currentEdge, maxSpeed: 50, freeFlowSpeed: 25 };
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);

      routeManager.updateSpeed(vehicle, 1000, { ...DEFAULT_OPTIONS, minSpeed: 1 });

      expect(vehicle.speed).toBeLessThanOrEqual(25);
    });

    it("should respect minSpeed as lower bound", () => {
      const vehicle = firstVehicle();
      vehicle.speed = 1;
      vehicle.targetSpeed = 1;

      // Clear congestion
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);

      routeManager.updateSpeed(vehicle, 1000, {
        ...DEFAULT_OPTIONS,
        minSpeed: 15,
        maxSpeed: 60,
      });

      expect(vehicle.speed).toBeGreaterThanOrEqual(15);
    });

    it("applies the weather factor as an extra cap so movement matches the routing ETA (fleetsim-all-1ajn.5)", () => {
      const vehicle = firstVehicle();
      vehicle.currentEdge = { ...vehicle.currentEdge, maxSpeed: 50, freeFlowSpeed: 40 };
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);
      vi.spyOn(network, "getWeatherFactor").mockReturnValue(0.5);

      routeManager.updateSpeed(vehicle, 1000, { ...DEFAULT_OPTIONS, minSpeed: 1 });

      expect(vehicle.speed).toBeLessThanOrEqual(20); // 40 x 0.5
    });

    it("leaves movement unaffected when the weather factor is 1 (no effect / disabled)", () => {
      const vehicle = firstVehicle();
      vehicle.currentEdge = { ...vehicle.currentEdge, maxSpeed: 50, freeFlowSpeed: 25 };
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);
      vi.spyOn(network, "getWeatherFactor").mockReturnValue(1);

      routeManager.updateSpeed(vehicle, 1000, { ...DEFAULT_OPTIONS, minSpeed: 1 });

      expect(vehicle.speed).toBeLessThanOrEqual(25);
    });
  });

  // ─── updateVehicle ────────────────────────────────────────────────

  describe("updateVehicle", () => {
    it("should skip movement when dwelling", () => {
      const vehicle = firstVehicle();
      vehicle.dwellUntil = Date.now() + 60_000;
      const originalPos: [number, number] = [...vehicle.position];
      const originalProgress = vehicle.progress;

      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);

      expect(vehicle.position[0]).toBe(originalPos[0]);
      expect(vehicle.position[1]).toBe(originalPos[1]);
      expect(vehicle.progress).toBe(originalProgress);
    });

    it("should clear dwellUntil when dwell period has passed", () => {
      const vehicle = firstVehicle();
      vehicle.dwellUntil = Date.now() - 1000;

      // Stub setRandomDestination to avoid pathfinding
      routeManager.setRandomDestination = vi.fn();

      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);

      expect(vehicle.dwellUntil).toBeUndefined();
    });

    it("should update position when not dwelling", () => {
      const vehicle = firstVehicle();
      vehicle.dwellUntil = undefined;
      vehicle.speed = 40;
      vehicle.targetSpeed = 40;
      vehicle.progress = 0;
      const originalPos: [number, number] = [...vehicle.position];

      // Stub setRandomDestination
      routeManager.setRandomDestination = vi.fn();

      routeManager.updateVehicle(vehicle, 2000, {
        ...DEFAULT_OPTIONS,
        minSpeed: 30,
        maxSpeed: 60,
      });

      const moved =
        vehicle.position[0] !== originalPos[0] || vehicle.position[1] !== originalPos[1];
      expect(moved).toBe(true);
    });
  });

  // ─── getDirections ────────────────────────────────────────────────

  describe("getDirections", () => {
    it("should return empty array when no routes are set", () => {
      expect(routeManager.getDirections()).toHaveLength(0);
    });

    it("should return directions for vehicles with routes", () => {
      const vehicle = firstVehicle();
      const edge = vehicle.currentEdge;
      const route: Route = { edges: [edge], distance: edge.distance };
      routeManager.setRoute(vehicle.id, route);

      const directions = routeManager.getDirections();
      expect(directions).toHaveLength(1);
      expect(directions[0].vehicleId).toBe(vehicle.id);
      expect(directions[0].route).toBeDefined();
    });
  });

  // ─── findAndSetRoutes ─────────────────────────────────────────────

  describe("findAndSetRoutes", () => {
    afterEach(async () => {
      await network.shutdownWorkers();
    });

    it("should return error for non-existent vehicle", async () => {
      const result = await routeManager.findAndSetRoutes("non-existent", [45.502, -73.567]);
      expect(result.status).toBe("error");
      expect(result.error).toContain("not found");
    });

    it("should emit direction event on success", async () => {
      const vehicle = firstVehicle();
      const startNode = network.findNearestNode([45.502, -73.567]);
      vehicle.currentEdge = startNode.connections[0];
      vehicle.position = startNode.connections[0].start.coordinates;
      vehicle.progress = 0;

      const directionListener = vi.fn();
      routeManager.on("direction", directionListener);

      const result = await routeManager.findAndSetRoutes(vehicle.id, [45.5029, -73.5661]);

      if (result.status === "ok") {
        expect(directionListener).toHaveBeenCalledTimes(1);
        expect(directionListener.mock.calls[0][0].vehicleId).toBe(vehicle.id);
      }

      routeManager.off("direction", directionListener);
    });
  });

  describe("estimateTo", () => {
    it("prices each edge at min(profile max, edge free-flow speed), like movement", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      // Explicitly zero nodeDelayH: `base` is a real fixture edge, which may
      // carry a precomputed node-control delay that would otherwise leak
      // through the spread and pollute this speed/distance-only assertion.
      const slow = { ...base, distance: 1, maxSpeed: 50, freeFlowSpeed: 30, nodeDelayH: undefined };
      const fast = {
        ...base,
        distance: 2,
        maxSpeed: 110,
        freeFlowSpeed: 99,
        nodeDelayH: undefined,
      };
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({ edges: [slow, fast], distance: 3 });

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      const expected = (1 / Math.min(30, profileMax) + 2 / Math.min(99, profileMax)) * 3600;
      expect(est).not.toBeNull();
      expect(est!.etaSeconds).toBeCloseTo(expected, 6);
      expect(est!.distanceKm).toBe(3);
    });

    it("adds each edge's precomputed node-control delay on top of travel time", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      // One plain edge (nodeDelayH explicitly zeroed — `base` is a real fixture
      // edge and may carry one of its own), one ending at a signalized/stopped node.
      const plain = {
        ...base,
        distance: 1,
        maxSpeed: 50,
        freeFlowSpeed: 30,
        nodeDelayH: undefined,
      };
      const controlled = {
        ...base,
        distance: 1,
        maxSpeed: 50,
        freeFlowSpeed: 30,
        nodeDelayH: 25 / 3600,
      };
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({
        edges: [plain, controlled],
        distance: 2,
      });

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      const travelHours = (1 / Math.min(30, profileMax)) * 2;
      const expectedSeconds = (travelHours + 25 / 3600) * 3600;
      expect(est).not.toBeNull();
      expect(est!.etaSeconds).toBeCloseTo(expectedSeconds, 6);
    });

    it("prices an edge with a learned speed at that speed instead of free-flow", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      const learned = {
        ...base,
        distance: 1,
        maxSpeed: 50,
        freeFlowSpeed: 30,
        nodeDelayH: undefined,
      };
      const plain = { ...learned };
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({
        edges: [learned, plain],
        distance: 2,
      });
      vi.spyOn(network, "turnCostHours").mockReturnValue(0);
      vi.spyOn(network, "learnedSpeedKmh").mockImplementation((e) =>
        e === learned ? 12 : undefined
      );

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      const expected = (1 / Math.min(12, profileMax) + 1 / Math.min(30, profileMax)) * 3600;
      expect(est!.etaSeconds).toBeCloseTo(expected, 6);
    });

    it("adds the turn cost the route search charges between consecutive edges", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      const edge = { ...base, distance: 1, maxSpeed: 50, freeFlowSpeed: 30, nodeDelayH: undefined };
      const route = [edge, { ...edge }, { ...edge }];
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({ edges: route, distance: 3 });
      const turnSpy = vi.spyOn(network, "turnCostHours").mockReturnValue(7 / 3600);

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      const expectedSeconds = (3 / Math.min(30, profileMax)) * 3600 + 2 * 7;
      expect(turnSpy).toHaveBeenCalledTimes(2);
      expect(turnSpy).toHaveBeenCalledWith(route[0], route[1]);
      expect(est!.etaSeconds).toBeCloseTo(expectedSeconds, 6);
    });

    it("applies the current weather factor to edge speed, like routing cost (fleetsim-all-1ajn.5)", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      const edge = { ...base, distance: 1, maxSpeed: 50, freeFlowSpeed: 30, nodeDelayH: undefined };
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({ edges: [edge], distance: 1 });
      vi.spyOn(network, "getWeatherFactor").mockReturnValue(0.5);

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      // Dividing travel time by the weather factor is equivalent to
      // multiplying speed by it — matches applyDynamicCost in pathfinding/cost.ts.
      const expected = (1 / (Math.min(30, profileMax) * 0.5)) * 3600;
      expect(est!.etaSeconds).toBeCloseTo(expected, 6);
    });

    it("does NOT scale node delay by the weather factor", async () => {
      const vehicle = firstVehicle();
      const base = vehicle.currentEdge;
      const edge = { ...base, distance: 1, maxSpeed: 50, freeFlowSpeed: 30, nodeDelayH: 25 / 3600 };
      vi.spyOn(network, "findRouteAsync").mockResolvedValue({ edges: [edge], distance: 1 });
      vi.spyOn(network, "getWeatherFactor").mockReturnValue(0.5);

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      const profileMax = getProfile(vehicle.type).maxSpeed;
      const expected = (1 / (Math.min(30, profileMax) * 0.5) + 25 / 3600) * 3600;
      expect(est!.etaSeconds).toBeCloseTo(expected, 6);
    });
  });

  // ─── Arrival edge (turn rules at a moving vehicle's next node) ─────

  describe("arrival edge", () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("setRandomDestination routes from currentEdge.end with currentEdge as the arrival", async () => {
      const vehicle = firstVehicle();
      const spy = vi.spyOn(network, "findRouteAsync").mockResolvedValue(null);
      routeManager.setRandomDestination(vehicle.id);
      await flush();
      expect(spy.mock.calls[0][0]).toBe(vehicle.currentEdge.end);
      expect(spy.mock.calls[0][3]).toBe(vehicle.currentEdge);
    });

    it("falls back to an unconstrained search when the arrival leaves no legal route", async () => {
      const vehicle = firstVehicle();
      const route: Route = { edges: [vehicle.currentEdge], distance: 1 };
      const spy = vi
        .spyOn(network, "findRouteAsync")
        .mockImplementation(async (_s, _e, _r, arrival) => (arrival ? null : route));
      routeManager.setRandomDestination(vehicle.id);
      await flush();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1][3]).toBeUndefined();
      expect(routeManager.getRoute(vehicle.id)).toBe(route);
    });

    it("an incident reroute passes currentEdge as the arrival", async () => {
      const vehicle = firstVehicle();
      routeManager.setRoute(vehicle.id, { edges: [vehicle.currentEdge], distance: 1 });
      const spy = vi.spyOn(network, "findRouteAsync").mockResolvedValue(null);
      (routeManager as any).dispatchReroute(vehicle.id, "inc-1");
      await flush();
      expect(spy.mock.calls[0][0]).toBe(vehicle.currentEdge.end);
      expect(spy.mock.calls[0][3]).toBe(vehicle.currentEdge);
    });

    it("estimateTo charges the first turn off currentEdge when starting at its end node", async () => {
      const vehicle = firstVehicle();
      vehicle.position = [...vehicle.currentEdge.end.coordinates] as [number, number];
      const edge = {
        ...vehicle.currentEdge,
        distance: 1,
        maxSpeed: 50,
        freeFlowSpeed: 30,
        nodeDelayH: undefined,
      };
      const spy = vi.spyOn(network, "findRouteAsync").mockResolvedValue({
        edges: [edge],
        distance: 1,
      });
      const turnSpy = vi.spyOn(network, "turnCostHours").mockReturnValue(9 / 3600);

      const est = await routeManager.estimateTo(vehicle.id, [45.5029, -73.5661]);

      expect(spy.mock.calls[0][3]).toBe(vehicle.currentEdge);
      expect(turnSpy).toHaveBeenCalledWith(vehicle.currentEdge, edge);
      const profileMax = getProfile(vehicle.type).maxSpeed;
      expect(est!.etaSeconds).toBeCloseTo((1 / Math.min(30, profileMax)) * 3600 + 9, 6);
    });
  });

  // ─── Incident rerouting ───────────────────────────────────────────

  describe("handleIncidentCreated", () => {
    it("should not crash when no routes exist", () => {
      expect(() => {
        routeManager.handleIncidentCreated({
          id: "i1",
          edgeIds: ["e1"],
          type: "accident",
          severity: 0.8,
          speedFactor: 0.1,
          startTime: Date.now(),
          duration: 60000,
          autoClears: true,
          position: [0, 0],
        });
      }).not.toThrow();
    });
  });

  // ─── Unrouted-vehicle metric / sampled warning ─────────────────────

  describe("unrouted vehicle tracking", () => {
    beforeEach(() => {
      vi.mocked(logger.warn).mockClear();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs a warning and records the gauge on the first unrouted retry", () => {
      const vehicle = firstVehicle();
      routeManager.setRandomDestination = vi.fn();
      const gaugeSpy = vi.spyOn(metrics, "setUnroutedVehicles");

      // No route set -> updateVehicle takes the "unrouted" branch immediately
      // (lastPathfindAttempt starts empty, so the cooldown gate passes).
      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Vehicle ${vehicle.id} still unrouted after 1 pathfind attempt`)
      );
      expect(gaugeSpy).toHaveBeenCalledWith(1);
      expect(routeManager.setRandomDestination).toHaveBeenCalledWith(vehicle.id);
    });

    it("does not spam a warning on every retry, only first + every Nth", () => {
      const vehicle = firstVehicle();
      routeManager.setRandomDestination = vi.fn();

      // Drive PATHFIND_COOLDOWN + 1 retries by advancing lastPathfindAttempt
      // into the past before each call, bypassing real timers.
      const cooldown = (RouteManager as any).PATHFIND_COOLDOWN as number;
      const attempts = UNROUTED_LOG_SAMPLE_RATE + 1;
      for (let i = 0; i < attempts; i++) {
        (routeManager as any).lastPathfindAttempt.set(vehicle.id, Date.now() - cooldown - 1);
        routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);
      }

      // Only the 1st and the (UNROUTED_LOG_SAMPLE_RATE)th attempts should log.
      const unroutedWarnings = vi
        .mocked(logger.warn)
        .mock.calls.filter((call) => String(call[0]).includes("still unrouted"));
      expect(unroutedWarnings).toHaveLength(2);
      expect(unroutedWarnings[0][0]).toContain("after 1 pathfind attempt");
      expect(unroutedWarnings[1][0]).toContain(
        `after ${UNROUTED_LOG_SAMPLE_RATE} pathfind attempt`
      );
    });

    it("clears the unrouted count once a route is successfully assigned", async () => {
      const vehicle = firstVehicle();
      const gaugeSpy = vi.spyOn(metrics, "setUnroutedVehicles");

      // Stub the pathfinder to resolve deterministically (avoids depending on
      // real worker-pool timing) with a route for the vehicle's current edge.
      const route: Route = {
        edges: [vehicle.currentEdge],
        distance: vehicle.currentEdge.distance,
      };
      const findRouteSpy = vi.spyOn(network, "findRouteAsync").mockResolvedValue(route);

      // Trigger one failed-cooldown retry to populate unroutedAttempts and
      // kick off setRandomDestination (which calls findRouteAsync above).
      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);
      expect(gaugeSpy).toHaveBeenLastCalledWith(1);

      // Let the mocked pathfind promise settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(findRouteSpy).toHaveBeenCalled();
      expect(gaugeSpy).toHaveBeenLastCalledWith(0);
    });
  });

  // ─── reset ────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should clear all route state", () => {
      const vehicle = firstVehicle();
      routeManager.setRoute(vehicle.id, { edges: [], distance: 0 });

      routeManager.reset();

      expect(routeManager.getRoute(vehicle.id)).toBeUndefined();
      expect(routeManager.getDirections()).toHaveLength(0);
    });

    it("should zero out the unrouted-vehicles gauge", () => {
      const gaugeSpy = vi.spyOn(metrics, "setUnroutedVehicles");
      const vehicle = firstVehicle();
      routeManager.setRandomDestination = vi.fn();
      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);
      expect(gaugeSpy).toHaveBeenLastCalledWith(1);

      routeManager.reset();

      expect(gaugeSpy).toHaveBeenLastCalledWith(0);
    });
  });
});

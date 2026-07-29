import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RouteManager } from "../modules/RouteManager";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { TrafficManager } from "../modules/TrafficManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle, StartOptions } from "../types";
import path from "path";

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

/**
 * Handover between the legs of a multi-stop route, and between a multi-stop
 * route and whatever replaces it.
 *
 * These are the seams the job lifecycle rides on: `JobManager` reads
 * `waypoint:reached` as "the load was collected" and `route:completed` as "the
 * load was delivered", so a leg handover that loses the remaining stops — or a
 * replaced route that still emits the old route's waypoint events — makes the
 * job board describe a trip that never happened.
 */
describe("RouteManager multi-stop handover", () => {
  let network: RoadNetwork;
  let registry: VehicleRegistry;
  let routeManager: RouteManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 2;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);
    registry = new VehicleRegistry(network, new FleetManager());
    routeManager = new RouteManager(network, registry, new TrafficManager());
    routeManager.getClockHour = () => 12;
    registry.loadFromData();
  });

  afterEach(async () => {
    await network.shutdownWorkers();
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
  });

  function firstVehicle(): Vehicle {
    return registry.getAll().values().next().value!;
  }

  /** Puts a vehicle somewhere both fixture destinations are routable from. */
  function placeOnRoutableEdge(vehicle: Vehicle): void {
    const startNode = network.findNearestNode([45.502, -73.567]);
    vehicle.currentEdge = startNode.connections[0];
    vehicle.position = vehicle.currentEdge.start.coordinates;
    vehicle.progress = 0;
  }

  describe("dwell at an intermediate stop", () => {
    it("resumes the remaining legs instead of wandering off", async () => {
      const vehicle = firstVehicle();
      placeOnRoutableEdge(vehicle);

      const result = await routeManager.findAndSetWaypointRoutes(vehicle.id, [
        { position: [45.5029, -73.5661], label: "pickup", dwellTime: 5 },
        { position: [45.5026, -73.5664], label: "dropoff", dwellTime: 0 },
      ]);
      expect(result.status).toBe("ok");

      // Mid-route state after the first stop: the next leg is already loaded and
      // the vehicle is holding at the stop for its dwell.
      const legRoute = routeManager.getRoute(vehicle.id);
      expect(legRoute).toBeDefined();
      vehicle.dwellUntil = Date.now() - 1;

      const random = vi.spyOn(routeManager, "setRandomDestination");
      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);

      expect(random).not.toHaveBeenCalled();
      expect(vehicle.dwellUntil).toBeUndefined();
      // The remaining leg — and the waypoints that describe it — survive.
      expect(routeManager.getRoute(vehicle.id)).toBe(legRoute);
      expect(vehicle.waypoints).toHaveLength(2);
    });

    it("still wanders when the dwell ends with no route left", () => {
      const vehicle = firstVehicle();
      placeOnRoutableEdge(vehicle);
      routeManager.deleteRoute(vehicle.id);
      vehicle.dwellUntil = Date.now() - 1;

      const random = vi.spyOn(routeManager, "setRandomDestination").mockImplementation(() => {});
      routeManager.updateVehicle(vehicle, 500, DEFAULT_OPTIONS);

      expect(random).toHaveBeenCalledWith(vehicle.id);
    });
  });

  describe("a single-destination dispatch replaces a multi-stop route", () => {
    it("drops the abandoned stops so their events can never fire", async () => {
      const vehicle = firstVehicle();
      placeOnRoutableEdge(vehicle);

      await routeManager.findAndSetWaypointRoutes(vehicle.id, [
        { position: [45.5029, -73.5661], label: "pickup", dwellTime: 0 },
        { position: [45.5026, -73.5664], label: "dropoff", dwellTime: 0 },
      ]);
      expect(vehicle.waypoints).toHaveLength(2);

      const dispatched = await routeManager.findAndSetRoutes(vehicle.id, [45.5026, -73.5664]);
      expect(dispatched.status).toBe("ok");

      expect(vehicle.waypoints).toBeUndefined();
      expect(vehicle.currentWaypointIndex).toBeUndefined();

      // Completing the dispatched route must not replay the old trip's stops.
      const events: string[] = [];
      routeManager.on("waypoint:reached", () => events.push("waypoint:reached"));
      routeManager.on("route:completed", () => events.push("route:completed"));
      (routeManager as any).handleRouteCompleted(vehicle);
      expect(events).toEqual([]);
    });
  });

  describe("direction reason", () => {
    it("labels a job/multi-stop route, a dispatch and a wander differently", async () => {
      const vehicle = firstVehicle();
      placeOnRoutableEdge(vehicle);

      const reasons: (string | undefined)[] = [];
      routeManager.on("direction", (payload) => reasons.push(payload.reason));

      await routeManager.findAndSetWaypointRoutes(vehicle.id, [
        { position: [45.5029, -73.5661], label: "pickup", dwellTime: 0 },
      ]);
      await routeManager.findAndSetRoutes(vehicle.id, [45.5026, -73.5664]);

      expect(reasons).toEqual(["waypoints", "dispatch"]);
    });
  });
});

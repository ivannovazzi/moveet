import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { SimulationController } from "../modules/SimulationController";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import path from "path";

vi.mock("../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("Multi-stop waypoint routing", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let controller: SimulationController;
  let origAdapterURL: string;
  let origVehicleCount: number;

  function placeOnRoutableEdge(vehicleId: string): void {
    const internalVehicle = (manager as any).vehicles.get(vehicleId);
    const startNode = network.findNearestNode([45.502, -73.567]);
    const startEdge = startNode.connections[0];
    internalVehicle.currentEdge = startEdge;
    internalVehicle.position = startEdge.start.coordinates;
    internalVehicle.progress = 0;
  }

  beforeEach(() => {
    origAdapterURL = config.adapterURL;
    origVehicleCount = config.vehicleCount;
    (config as any).vehicleCount = 3;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);

    const origProto = VehicleManager.prototype as any;
    const origSetRandom = origProto.setRandomDestination;
    origProto.setRandomDestination = function () {};

    manager = new VehicleManager(network, new FleetManager());

    origProto.setRandomDestination = origSetRandom;
    controller = new SimulationController(manager);
  });

  afterEach(async () => {
    const vehicles = manager.getVehicles();
    for (const v of vehicles) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
    await network.shutdownWorkers();
    (config as any).adapterURL = origAdapterURL;
    (config as any).vehicleCount = origVehicleCount;
    vi.restoreAllMocks();
  });

  // ─── Single-destination backward compatibility ─────────────────────

  describe("backward compatibility", () => {
    it("should still work with single lat/lng destination (no waypoints)", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const results = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661 },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(results[0].route).toBeDefined();
      expect(results[0].waypointCount).toBeUndefined();
      expect(results[0].legs).toBeUndefined();
    });

    it("should ignore waypoints field when it is an empty array", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const results = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661, waypoints: [] },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(results[0].waypointCount).toBeUndefined();
    });
  });

  // ─── Multi-waypoint dispatch ────────────────────────────────────────

  describe("multi-waypoint dispatch", () => {
    it("should return ok with waypointCount and legs for multi-stop route", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const results = await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, label: "Pickup" },
            { lat: 45.5026, lng: -73.5664, label: "Delivery" },
          ],
        },
      ]);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.status).toBe("ok");
      expect(result.waypointCount).toBe(2);
      expect(result.legs).toHaveLength(2);
      expect(result.legs![0].distance).toBeGreaterThan(0);
      expect(result.legs![1].distance).toBeGreaterThan(0);
      expect(result.route!.distance).toBe(result.legs![0].distance + result.legs![1].distance);
    });

    it("should set waypoint state on the vehicle", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, label: "A" },
            { lat: 45.5026, lng: -73.5664, label: "B" },
          ],
        },
      ]);

      const internalVehicle = (manager as any).vehicles.get(vehicleId);
      expect(internalVehicle.waypoints).toHaveLength(2);
      expect(internalVehicle.currentWaypointIndex).toBe(0);
      expect(internalVehicle.waypoints[0].label).toBe("A");
      expect(internalVehicle.waypoints[1].label).toBe("B");
    });

    it("should return error for non-existent vehicle", async () => {
      const results = await controller.setDirections([
        {
          id: "nonexistent",
          lat: 0,
          lng: 0,
          waypoints: [{ lat: 45.5029, lng: -73.5661 }],
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("error");
      expect(results[0].error).toContain("nonexistent");
    });
  });

  // ─── Waypoint progression ──────────────────────────────────────────

  describe("waypoint progression", () => {
    it("should emit waypoint:reached when vehicle completes a leg", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, label: "WP1", dwellTime: 1 },
            { lat: 45.5026, lng: -73.5664, label: "WP2" },
          ],
        },
      ]);

      const waypointEvents: any[] = [];
      const routeCompleteEvents: any[] = [];
      manager.on("waypoint:reached", (data) => waypointEvents.push(data));
      manager.on("route:completed", (data) => routeCompleteEvents.push(data));

      // Simulate reaching the end of leg 0 by calling handleRouteCompleted directly
      const vehicle = (manager as any).vehicles.get(vehicleId);
      (manager as any).handleRouteCompleted(vehicle);

      expect(waypointEvents).toHaveLength(1);
      expect(waypointEvents[0].vehicleId).toBe(vehicleId);
      expect(waypointEvents[0].waypointIndex).toBe(0);
      expect(waypointEvents[0].waypointLabel).toBe("WP1");
      expect(waypointEvents[0].remaining).toBe(1);

      // Should set up the next leg
      expect(vehicle.currentWaypointIndex).toBe(1);
      expect(vehicle.dwellUntil).toBeDefined();
    });

    it("should emit route:completed when final waypoint is reached", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [{ lat: 45.5029, lng: -73.5661, label: "Only" }],
        },
      ]);

      const routeCompleteEvents: any[] = [];
      manager.on("route:completed", (data) => routeCompleteEvents.push(data));

      const vehicle = (manager as any).vehicles.get(vehicleId);
      (manager as any).handleRouteCompleted(vehicle);

      expect(routeCompleteEvents).toHaveLength(1);
      expect(routeCompleteEvents[0].vehicleId).toBe(vehicleId);

      // Waypoint state should be cleared
      expect(vehicle.waypoints).toBeUndefined();
      expect(vehicle.currentWaypointIndex).toBeUndefined();
    });

    it("should use configured dwellTime at waypoints", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const customDwell = 30; // 30 seconds
      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, dwellTime: customDwell },
            { lat: 45.5026, lng: -73.5664 },
          ],
        },
      ]);

      const vehicle = (manager as any).vehicles.get(vehicleId);
      const beforeDwell = Date.now();
      (manager as any).handleRouteCompleted(vehicle);

      // dwellUntil should be approximately now + customDwell seconds
      const dwellDelta = vehicle.dwellUntil! - beforeDwell;
      expect(dwellDelta).toBeGreaterThanOrEqual(customDwell * 1000 - 100);
      expect(dwellDelta).toBeLessThanOrEqual(customDwell * 1000 + 100);
    });
  });

  // ─── getDirections with waypoint metadata ───────────────────────────

  describe("getDirections with waypoint metadata", () => {
    it("should include waypoints and currentWaypointIndex in directions", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, label: "Stop1" },
            { lat: 45.5026, lng: -73.5664, label: "Stop2" },
          ],
        },
      ]);

      const directions = manager.getDirections();
      const dir = directions.find((d) => d.vehicleId === vehicleId);
      expect(dir).toBeDefined();
      expect(dir!.waypoints).toHaveLength(2);
      expect(dir!.waypoints![0].label).toBe("Stop1");
      expect(dir!.currentWaypointIndex).toBe(0);
    });

    it("should not include waypoint metadata for single-destination routes", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      await controller.setDirections([{ id: vehicleId, lat: 45.5029, lng: -73.5661 }]);

      const directions = manager.getDirections();
      const dir = directions.find((d) => d.vehicleId === vehicleId);
      expect(dir).toBeDefined();
      expect(dir!.waypoints).toBeUndefined();
      expect(dir!.currentWaypointIndex).toBeUndefined();
    });
  });

  // ─── Chained A* pathfinding ─────────────────────────────────────────

  describe("chained A* pathfinding", () => {
    it("should return error when one leg is unroutable", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      // Mock findRouteAsync to fail on the second call
      let callCount = 0;
      const origFindRoute = network.findRouteAsync.bind(network);
      vi.spyOn(network, "findRouteAsync").mockImplementation(async (...args) => {
        callCount++;
        if (callCount === 2) return null; // fail second leg
        return origFindRoute(...args);
      });

      const results = await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661 },
            { lat: 45.5026, lng: -73.5664 },
          ],
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("error");
      expect(results[0].error).toContain("leg");
    });

    it("should handle single waypoint (one leg)", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const results = await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [{ lat: 45.5029, lng: -73.5661, label: "Only stop" }],
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(results[0].waypointCount).toBe(1);
      expect(results[0].legs).toHaveLength(1);
    });
  });

  // ─── Direction event emission ───────────────────────────────────────

  describe("direction event", () => {
    it("should emit direction event with waypoints and currentWaypointIndex", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      const directionEvents: any[] = [];
      manager.on("direction", (data) => directionEvents.push(data));

      await controller.setDirections([
        {
          id: vehicleId,
          lat: 0,
          lng: 0,
          waypoints: [
            { lat: 45.5029, lng: -73.5661, label: "A" },
            { lat: 45.5026, lng: -73.5664, label: "B" },
          ],
        },
      ]);

      // Find the direction event from waypoint routing (not from setRandomDestination)
      const wpEvent = directionEvents.find((e) => e.waypoints);
      expect(wpEvent).toBeDefined();
      expect(wpEvent.vehicleId).toBe(vehicleId);
      expect(wpEvent.waypoints).toHaveLength(2);
      expect(wpEvent.currentWaypointIndex).toBe(0);
      expect(wpEvent.eta).toBeGreaterThan(0);
    });
  });
});

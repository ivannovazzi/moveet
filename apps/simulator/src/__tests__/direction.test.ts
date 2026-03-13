import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { SimulationController } from "../modules/SimulationController";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import path from "path";

// Mock logger to suppress output
vi.mock("../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("POST /direction (SimulationController.setDirections)", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let controller: SimulationController;
  let origAdapterURL: string;
  let origVehicleCount: number;

  /** Place a vehicle on a known bidirectional edge so A* routing reliably succeeds. */
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
    // Use a small count so the tiny test network isn't overloaded.
    (config as any).vehicleCount = 3;
    // Ensure no adapter so loadFromData() is called in the constructor.
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);

    // Stub setRandomDestination before constructor runs to prevent
    // crashes from empty-edge routes on the tiny test network.
    const origProto = VehicleManager.prototype as any;
    const origSetRandom = origProto.setRandomDestination;
    origProto.setRandomDestination = function () {
      // no-op: skip pathfinding during init
    };

    manager = new VehicleManager(network, new FleetManager());

    // Restore so tests that need it can call it explicitly
    origProto.setRandomDestination = origSetRandom;

    controller = new SimulationController(manager);
  });

  afterEach(async () => {
    // Stop all vehicle movements and location updates to prevent timer leaks
    const vehicles = manager.getVehicles();
    for (const v of vehicles) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
    await network.shutdownWorkers();
    // Restore config
    (config as any).adapterURL = origAdapterURL;
    (config as any).vehicleCount = origVehicleCount;
    vi.restoreAllMocks();
  });

  // ─── Valid single vehicle dispatch ─────────────────────────────────

  describe("valid single vehicle dispatch", () => {
    it("should return status 'ok' with route, eta, and snappedTo for a valid dispatch", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;
      placeOnRoutableEdge(vehicleId);

      // Dispatch to a known reachable node in the test network
      // First Avenue endpoint: [45.5029, -73.5661]
      const results = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661 },
      ]);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.vehicleId).toBe(vehicleId);
      expect(result.status).toBe("ok");

      // Route should have start, end, and positive distance
      expect(result.route).toBeDefined();
      expect(result.route!.start).toHaveLength(2);
      expect(result.route!.end).toHaveLength(2);
      expect(result.route!.distance).toBeGreaterThan(0);

      // ETA should be a positive number (seconds)
      expect(result.eta).toBeDefined();
      expect(result.eta).toBeGreaterThan(0);

      // snappedTo should be the nearest node coordinates to the destination
      expect(result.snappedTo).toBeDefined();
      expect(result.snappedTo).toHaveLength(2);
    });
  });

  // ─── Valid batch dispatch ──────────────────────────────────────────

  describe("valid batch dispatch", () => {
    it("should return status 'ok' for all vehicles dispatched to different destinations", async () => {
      const vehicles = manager.getVehicles();
      expect(vehicles.length).toBeGreaterThanOrEqual(2);
      placeOnRoutableEdge(vehicles[0].id);
      placeOnRoutableEdge(vehicles[1].id);

      // Use destinations reachable from any node in the test network
      // (Main Street is oneway, so some nodes can't be reached from all starts)
      // Both destinations are on First Avenue which is bidirectional and reachable via Main Street
      const requests = [
        { id: vehicles[0].id, lat: 45.5029, lng: -73.5661 }, // First Avenue endpoint
        { id: vehicles[1].id, lat: 45.5026, lng: -73.5664 }, // First Avenue midpoint
      ];

      const results = await controller.setDirections(requests);

      expect(results).toHaveLength(2);

      for (let i = 0; i < results.length; i++) {
        expect(results[i].vehicleId).toBe(requests[i].id);
        expect(results[i].status).toBe("ok");
        expect(results[i].route).toBeDefined();
        expect(results[i].route!.distance).toBeGreaterThan(0);
        expect(results[i].eta).toBeGreaterThan(0);
        expect(results[i].snappedTo).toBeDefined();
      }
    });
  });

  // ─── Invalid vehicle ID ────────────────────────────────────────────

  describe("invalid vehicle ID", () => {
    it("should return status 'error' with descriptive message for non-existent vehicle", async () => {
      const results = await controller.setDirections([
        { id: "non-existent-vehicle", lat: 45.5029, lng: -73.5661 },
      ]);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.vehicleId).toBe("non-existent-vehicle");
      expect(result.status).toBe("error");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("non-existent-vehicle");
    });
  });

  // ─── Unreachable destination ───────────────────────────────────────

  describe("unreachable destination", () => {
    it("should return status 'error' when destination node has no connections", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;

      // Mock findNearestNode to return an isolated node for the destination
      const origFindNearest = network.findNearestNode.bind(network);
      let callCount = 0;
      vi.spyOn(network, "findNearestNode").mockImplementation((pos) => {
        callCount++;
        if (callCount === 2) {
          // Second call is for the destination — return isolated node
          return { id: "isolated", coordinates: [90, 180] as [number, number], connections: [] };
        }
        return origFindNearest(pos);
      });

      const results = await controller.setDirections([
        { id: vehicleId, lat: 90, lng: 180 },
      ]);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.vehicleId).toBe(vehicleId);
      expect(result.status).toBe("error");
      expect(result.error).toBeDefined();
    });

    it("should return status 'error' when no route can be found", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;

      // Mock findRouteAsync to return null (no route found)
      vi.spyOn(network, "findRouteAsync").mockResolvedValue(null);

      const results = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661 },
      ]);

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.vehicleId).toBe(vehicleId);
      expect(result.status).toBe("error");
      expect(result.error).toBeDefined();
      expect(result.snappedTo).toBeDefined();
    });
  });

  // ─── Empty request array ─────────────────────────────────────────

  describe("empty request array", () => {
    it("should return empty results array when given empty input", async () => {
      const results = await controller.setDirections([]);

      expect(results).toHaveLength(0);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── Duplicate vehicle IDs in batch ─────────────────────────────────

  describe("duplicate vehicle IDs in batch", () => {
    it("should succeed for both entries when same vehicle is dispatched twice", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;

      // Place vehicle on a known bidirectional edge (Second Avenue) so both dispatches
      // can succeed on this small directed test network.
      const internalVehicle = (manager as any).vehicles.get(vehicleId);
      const startNode = network.findNearestNode([45.502, -73.567]);
      const startEdge = startNode.connections[0];
      internalVehicle.currentEdge = startEdge;
      internalVehicle.position = startEdge.start.coordinates;
      internalVehicle.progress = 0;

      // Dispatch the same vehicle to two different destinations on First Avenue
      // (bidirectional road, reachable from the Second Avenue starting position)
      const results = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661 }, // First Avenue endpoint
        { id: vehicleId, lat: 45.5026, lng: -73.5664 }, // First Avenue midpoint
      ]);

      expect(results).toHaveLength(2);

      // Both should reference the same vehicle
      expect(results[0].vehicleId).toBe(vehicleId);
      expect(results[1].vehicleId).toBe(vehicleId);

      // Both should succeed (second overrides first)
      expect(results[0].status).toBe("ok");
      expect(results[1].status).toBe("ok");
    });
  });

  // ─── Vehicle re-dispatch replaces existing route ────────────────────

  describe("vehicle re-dispatch replaces existing route", () => {
    it("should replace an existing route when vehicle is dispatched again to a different destination", async () => {
      const vehicles = manager.getVehicles();
      const vehicleId = vehicles[0].id;

      // Place vehicle on a known bidirectional edge (Second Avenue) so dispatches
      // can succeed on this small directed test network.
      const internalVehicle = (manager as any).vehicles.get(vehicleId);
      const startNode = network.findNearestNode([45.502, -73.567]);
      const startEdge = startNode.connections[0];
      internalVehicle.currentEdge = startEdge;
      internalVehicle.position = startEdge.start.coordinates;
      internalVehicle.progress = 0;

      // First dispatch to First Avenue endpoint
      const firstResults = await controller.setDirections([
        { id: vehicleId, lat: 45.5029, lng: -73.5661 },
      ]);

      expect(firstResults).toHaveLength(1);
      expect(firstResults[0].status).toBe("ok");
      const firstRoute = firstResults[0].route;
      expect(firstRoute).toBeDefined();

      // Second dispatch to First Avenue midpoint (different destination on same
      // bidirectional road, guaranteed reachable after first dispatch repositioned
      // the vehicle onto First Avenue)
      const secondResults = await controller.setDirections([
        { id: vehicleId, lat: 45.5026, lng: -73.5664 },
      ]);

      expect(secondResults).toHaveLength(1);
      expect(secondResults[0].status).toBe("ok");
      const secondRoute = secondResults[0].route;
      expect(secondRoute).toBeDefined();

      // The new route should have a different end point than the first route
      expect(secondRoute!.end).not.toEqual(firstRoute!.end);
    });
  });

  // ─── Mixed success/failure ─────────────────────────────────────────

  describe("mixed success/failure batch", () => {
    it("should return partial success with some ok and some error results", async () => {
      const vehicles = manager.getVehicles();
      const validId = vehicles[0].id;
      placeOnRoutableEdge(validId);
      const invalidId = "does-not-exist";

      const results = await controller.setDirections([
        { id: validId, lat: 45.5029, lng: -73.5661 },
        { id: invalidId, lat: 45.5026, lng: -73.5676 },
      ]);

      expect(results).toHaveLength(2);

      // First result should succeed
      const successResult = results.find((r) => r.vehicleId === validId);
      expect(successResult).toBeDefined();
      expect(successResult!.status).toBe("ok");
      expect(successResult!.route).toBeDefined();
      expect(successResult!.eta).toBeGreaterThan(0);

      // Second result should fail
      const errorResult = results.find((r) => r.vehicleId === invalidId);
      expect(errorResult).toBeDefined();
      expect(errorResult!.status).toBe("error");
      expect(errorResult!.error).toBeDefined();
    });

    it("should process all requests in order even when some fail", async () => {
      const vehicles = manager.getVehicles();
      placeOnRoutableEdge(vehicles[0].id);

      const requests = [
        { id: "invalid-1", lat: 45.5029, lng: -73.5661 },
        { id: vehicles[0].id, lat: 45.5029, lng: -73.5661 },
        { id: "invalid-2", lat: 45.5026, lng: -73.5676 },
      ];

      const results = await controller.setDirections(requests);

      expect(results).toHaveLength(3);

      // Results should be in the same order as requests
      expect(results[0].vehicleId).toBe("invalid-1");
      expect(results[0].status).toBe("error");

      expect(results[1].vehicleId).toBe(vehicles[0].id);
      expect(results[1].status).toBe("ok");

      expect(results[2].vehicleId).toBe("invalid-2");
      expect(results[2].status).toBe("error");
    });
  });
});

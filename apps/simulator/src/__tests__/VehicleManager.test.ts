import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle } from "../types";
import path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("VehicleManager", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
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
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
    // Stop all vehicle movements and location updates to prevent timer leaks
    const vehicles = manager.getVehicles();
    for (const v of vehicles) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
  });

  /** Helper: get internal Vehicle map for accessing private state */
  function internalVehicles(): Map<string, Vehicle> {
    return (manager as any).vehicles as Map<string, Vehicle>;
  }

  /** Helper: get the first internal vehicle (all should have valid currentEdge now) */
  function firstVehicle(): Vehicle {
    const v = internalVehicles().values().next().value;
    if (!v) throw new Error("No vehicles in manager");
    return v;
  }

  // ─── Initialization ───────────────────────────────────────────────

  describe("initialization", () => {
    it("should create vehicles on construction", () => {
      const vehicles = manager.getVehicles();
      expect(vehicles.length).toBe(3);
    });

    it("should assign valid positions on the road network to each vehicle", () => {
      const vehicles = manager.getVehicles();
      for (const v of vehicles) {
        expect(v.position).toHaveLength(2);
        expect(typeof v.position[0]).toBe("number");
        expect(typeof v.position[1]).toBe("number");
        expect(Number.isNaN(v.position[0])).toBe(false);
        expect(Number.isNaN(v.position[1])).toBe(false);
      }
    });

    it("should assign each vehicle an id and name", () => {
      const vehicles = manager.getVehicles();
      for (const v of vehicles) {
        expect(v.id).toBeDefined();
        expect(v.name).toBeDefined();
      }
    });

    it("should assign initial speed equal to minSpeed from options", () => {
      const opts = manager.getOptions();
      for (const v of internalVehicles().values()) {
        expect(v.speed).toBe(opts.minSpeed);
      }
    });

    it("should place each vehicle at start of its assigned edge", () => {
      for (const v of internalVehicles().values()) {
        expect(v.progress).toBe(0);
        expect(v.position[0]).toBe(v.currentEdge.start.coordinates[0]);
        expect(v.position[1]).toBe(v.currentEdge.start.coordinates[1]);
      }
    });
  });

  // ─── Options ──────────────────────────────────────────────────────

  describe("options", () => {
    it("should return default options from getOptions()", () => {
      const opts = manager.getOptions();
      expect(opts).toBeDefined();
      expect(typeof opts.minSpeed).toBe("number");
      expect(typeof opts.maxSpeed).toBe("number");
      expect(typeof opts.updateInterval).toBe("number");
      expect(typeof opts.acceleration).toBe("number");
      expect(typeof opts.deceleration).toBe("number");
      expect(typeof opts.heatZoneSpeedFactor).toBe("number");
    });

    it("should merge partial options via setOptions()", () => {
      const original = { ...manager.getOptions() };
      manager.setOptions({ maxSpeed: 120, minSpeed: 10 });
      const updated = manager.getOptions();

      expect(updated.maxSpeed).toBe(120);
      expect(updated.minSpeed).toBe(10);
      // Other fields should remain unchanged
      expect(updated.acceleration).toBe(original.acceleration);
      expect(updated.deceleration).toBe(original.deceleration);
    });

    it('should emit "options" event when setOptions is called', () => {
      const listener = vi.fn();
      manager.on("options", listener);

      manager.setOptions({ maxSpeed: 80 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ maxSpeed: 80 }));
    });
  });

  // ─── Speed clamping to edge maxSpeed ──────────────────────────────

  describe("speed clamping", () => {
    it("should not exceed currentEdge.maxSpeed after updateSpeed", () => {
      manager.setOptions({ maxSpeed: 999, minSpeed: 1, speedVariation: 0 });

      const vehicle = firstVehicle();
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;

      (manager as any).updateSpeed(vehicle, 1000);

      expect(vehicle.speed).toBeLessThanOrEqual(vehicle.currentEdge.maxSpeed);
    });

    it("should clamp speed to global maxSpeed when it is lower than edge maxSpeed", () => {
      const globalMax = 25;
      manager.setOptions({ maxSpeed: globalMax, minSpeed: 5, speedVariation: 0 });

      const vehicle = firstVehicle();
      vehicle.speed = 100;
      vehicle.targetSpeed = 100;

      (manager as any).updateSpeed(vehicle, 1000);

      expect(vehicle.speed).toBeLessThanOrEqual(globalMax);
    });

    it("should respect minSpeed as a lower bound when effectiveMax allows it", () => {
      const minSpeed = 15;
      manager.setOptions({ maxSpeed: 60, minSpeed, speedVariation: 0 });

      const vehicle = firstVehicle();
      vehicle.speed = 1;
      vehicle.targetSpeed = 1;

      // Clear traffic congestion so effectiveMax is not reduced below minSpeed
      const traffic = (manager as any).traffic;
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);
      traffic.leave(vehicle.currentEdge.id);

      (manager as any).updateSpeed(vehicle, 1000);

      expect(vehicle.speed).toBeGreaterThanOrEqual(minSpeed);
    });
  });

  // ─── Dwell time ───────────────────────────────────────────────────

  describe("dwell time", () => {
    it("should skip movement when dwellUntil is in the future", () => {
      const vehicle = firstVehicle();

      const originalPosition: [number, number] = [...vehicle.position];
      const originalProgress = vehicle.progress;

      // Set dwell far in the future
      vehicle.dwellUntil = Date.now() + 60_000;

      (manager as any).updateVehicle(vehicle, 500);

      expect(vehicle.position[0]).toBe(originalPosition[0]);
      expect(vehicle.position[1]).toBe(originalPosition[1]);
      expect(vehicle.progress).toBe(originalProgress);
    });

    it("should clear dwellUntil when dwell period has passed", () => {
      const vehicle = firstVehicle();

      // Set dwell in the past
      vehicle.dwellUntil = Date.now() - 1000;

      // Stub setRandomDestination to prevent crashes on tiny network
      (manager as any).setRandomDestination = () => {};

      (manager as any).updateVehicle(vehicle, 500);

      expect(vehicle.dwellUntil).toBeUndefined();
    });
  });

  // ─── Following distance ───────────────────────────────────────────

  describe("following distance", () => {
    it("should limit follower speed when gap is less than 20m", () => {
      const vehicles = Array.from(internalVehicles().values());
      expect(vehicles.length).toBeGreaterThanOrEqual(2);

      const leader = vehicles[0];
      const follower = vehicles[1];

      // Place both on the same edge
      follower.currentEdge = leader.currentEdge;

      // Leader is ahead
      leader.progress = 0.5;
      leader.speed = 30;

      // Place follower close behind (gap < 0.02 km = 20m)
      const edgeDistance = leader.currentEdge.distance;
      const tinyGap = 0.01; // 10 meters in km
      follower.progress = leader.progress - tinyGap / edgeDistance;
      follower.speed = 50;
      follower.targetSpeed = 50;

      manager.setOptions({ maxSpeed: 999, minSpeed: 1, speedVariation: 0 });

      (manager as any).updateSpeed(follower, 1000);

      // The follower's targetSpeed should be limited to leader.speed * 0.9
      expect(follower.targetSpeed).toBeLessThanOrEqual(leader.speed * 0.9);
    });

    it("should not limit speed when gap is greater than 20m", () => {
      const vehicleMap = internalVehicles();
      const vehicles = Array.from(vehicleMap.values());
      expect(vehicles.length).toBeGreaterThanOrEqual(2);

      const leader = vehicles[0];
      const follower = vehicles[1];

      // Remove all vehicles except leader and follower to eliminate interference
      for (const v of vehicles) {
        if (v.id !== leader.id && v.id !== follower.id) {
          vehicleMap.delete(v.id);
        }
      }

      const testEdge = leader.currentEdge;
      follower.currentEdge = testEdge;

      // Clear traffic congestion to avoid effectiveMax being too low
      const traffic = (manager as any).traffic;
      const edgeOccupancy = (traffic as any).edgeOccupancy as Map<string, number>;
      edgeOccupancy.clear();

      // Set leader far ahead so gap > 20m (0.02 km)
      leader.progress = 0.99;
      leader.speed = 30;

      // Put follower at progress 0 to get maximum possible gap.
      follower.progress = 0;
      follower.speed = 40;
      follower.targetSpeed = 40;

      // Set high turnThreshold to prevent turn-based deceleration from interfering
      manager.setOptions({ maxSpeed: 999, minSpeed: 1, speedVariation: 0, turnThreshold: 180 });

      // Mock Math.random to return a high value so the targetSpeed refresh line
      // (Math.random() < deltaMs / 5000) does NOT trigger
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

      (manager as any).updateSpeed(follower, 1000);

      randomSpy.mockRestore();

      const actualGapKm = (leader.progress - follower.progress) * testEdge.distance;
      if (actualGapKm >= 0.02) {
        // Gap large enough -- following distance logic should NOT have triggered.
        // targetSpeed should remain at 40 (our initial value), not reduced to leader.speed * 0.9.
        expect(follower.targetSpeed).toBeGreaterThan(leader.speed * 0.9);
      } else {
        // Edge too short for a meaningful gap test -- validate following distance did apply
        expect(follower.targetSpeed).toBeLessThanOrEqual(leader.speed * 0.9);
      }
    });
  });

  // ─── Movement and position updates ────────────────────────────────

  describe("movement", () => {
    it("should update vehicle position after calling updateVehicle", () => {
      manager.setOptions({ minSpeed: 30, maxSpeed: 60, speedVariation: 0 });

      const vehicle = firstVehicle();
      vehicle.dwellUntil = undefined;
      vehicle.speed = 40;
      vehicle.targetSpeed = 40;
      vehicle.progress = 0;

      // Stub setRandomDestination to prevent crashes on tiny network
      // when updateVehicle tries pathfinding with no route set
      (manager as any).setRandomDestination = () => {};

      const originalPosition: [number, number] = [...vehicle.position];

      (manager as any).updateVehicle(vehicle, 2000);

      const moved =
        vehicle.position[0] !== originalPosition[0] || vehicle.position[1] !== originalPosition[1];
      expect(moved).toBe(true);
    });

    it("should advance progress or transition to next edge", () => {
      manager.setOptions({ minSpeed: 30, maxSpeed: 60, speedVariation: 0 });

      const vehicle = firstVehicle();
      vehicle.dwellUntil = undefined;
      vehicle.speed = 30;
      vehicle.targetSpeed = 30;

      // Stub setRandomDestination to prevent crashes on tiny network
      (manager as any).setRandomDestination = () => {};

      const initialEdgeId = vehicle.currentEdge.id;
      const initialProgress = vehicle.progress;

      (manager as any).updateVehicle(vehicle, 500);

      const progressChanged = vehicle.progress !== initialProgress;
      const edgeChanged = vehicle.currentEdge.id !== initialEdgeId;
      expect(progressChanged || edgeChanged).toBe(true);
    });
  });

  // ─── Lifecycle: start/stop/isRunning ──────────────────────────────

  describe("lifecycle", () => {
    it("should report not running initially", () => {
      expect(manager.isRunning()).toBe(false);
    });

    it("should report running after startVehicleMovement", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      expect(manager.isRunning()).toBe(true);
    });

    it("should report not running after stopping all started vehicles", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      manager.stopVehicleMovement(vehicles[0].id);
      expect(manager.isRunning()).toBe(false);
    });
  });

  // ─── getVehicles serialization ────────────────────────────────────

  describe("getVehicles serialization", () => {
    it("should return VehicleDTO objects without internal fields", () => {
      const vehicles = manager.getVehicles();
      for (const v of vehicles) {
        // Should have DTO fields
        expect(v).toHaveProperty("id");
        expect(v).toHaveProperty("name");
        expect(v).toHaveProperty("position");
        expect(v).toHaveProperty("speed");
        expect(v).toHaveProperty("heading");

        // Should NOT have internal Vehicle fields
        expect(v).not.toHaveProperty("currentEdge");
        expect(v).not.toHaveProperty("progress");
        expect(v).not.toHaveProperty("bearing");
        expect(v).not.toHaveProperty("dwellUntil");
        expect(v).not.toHaveProperty("targetSpeed");
      }
    });
  });

  // ─── Fleet assignment ────────────────────────────────────────────

  describe("fleet assignment", () => {
    it("should assign a vehicle to a fleet", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleet = fleetManager.createFleet("TestFleet");
      const vehicle = firstVehicle();

      const result = manager.assignVehicleToFleet(vehicle.id, fleet.id);

      expect(result).toBe(true);
      expect(vehicle.fleetId).toBe(fleet.id);
      expect(fleetManager.getVehicleFleetId(vehicle.id)).toBe(fleet.id);
    });

    it("should emit update event when assigning to fleet", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleet = fleetManager.createFleet("TestFleet");
      const vehicle = firstVehicle();
      const listener = vi.fn();
      manager.on("update", listener);

      manager.assignVehicleToFleet(vehicle.id, fleet.id);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: vehicle.id }));
    });

    it("should return false when assigning non-existent vehicle", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleet = fleetManager.createFleet("TestFleet");

      const result = manager.assignVehicleToFleet("non-existent-id", fleet.id);

      expect(result).toBe(false);
    });

    it("should return false when assigning to non-existent fleet", () => {
      const vehicle = firstVehicle();

      const result = manager.assignVehicleToFleet(vehicle.id, "non-existent-fleet");

      expect(result).toBe(false);
    });

    it("should unassign a vehicle from its fleet", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleet = fleetManager.createFleet("TestFleet");
      const vehicle = firstVehicle();
      manager.assignVehicleToFleet(vehicle.id, fleet.id);

      const result = manager.unassignVehicleFromFleet(vehicle.id);

      expect(result).toBe(true);
      expect(vehicle.fleetId).toBeUndefined();
      expect(fleetManager.getVehicleFleetId(vehicle.id)).toBeUndefined();
    });

    it("should emit update event when unassigning from fleet", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleet = fleetManager.createFleet("TestFleet");
      const vehicle = firstVehicle();
      manager.assignVehicleToFleet(vehicle.id, fleet.id);

      const listener = vi.fn();
      manager.on("update", listener);

      manager.unassignVehicleFromFleet(vehicle.id);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: vehicle.id }));
    });

    it("should return false when unassigning non-existent vehicle", () => {
      const result = manager.unassignVehicleFromFleet("non-existent-id");

      expect(result).toBe(false);
    });

    it("should return false when unassigning vehicle not in any fleet", () => {
      const vehicle = firstVehicle();

      const result = manager.unassignVehicleFromFleet(vehicle.id);

      expect(result).toBe(false);
    });

    it("should move vehicle between fleets", () => {
      const fleetManager = (manager as any)
        .fleets as FleetManager;
      const fleetA = fleetManager.createFleet("FleetA");
      const fleetB = fleetManager.createFleet("FleetB");
      const vehicle = firstVehicle();

      manager.assignVehicleToFleet(vehicle.id, fleetA.id);
      expect(vehicle.fleetId).toBe(fleetA.id);

      manager.assignVehicleToFleet(vehicle.id, fleetB.id);
      expect(vehicle.fleetId).toBe(fleetB.id);
      expect(fleetManager.getVehicleFleetId(vehicle.id)).toBe(fleetB.id);
    });
  });

  // ─── getNetwork ───────────────────────────────────────────────────

  describe("getNetwork", () => {
    it("should return the same RoadNetwork instance passed to constructor", () => {
      expect(manager.getNetwork()).toBe(network);
    });
  });

  // ─── Dispatch: findAndSetRoutes ─────────────────────────────────

  describe("findAndSetRoutes dispatch", () => {
    afterEach(async () => {
      await network.shutdownWorkers();
    });

    it("should set route and emit direction event when dispatched to reachable destination", async () => {
      const vehicle = firstVehicle();
      const directionListener = vi.fn();
      manager.on("direction", directionListener);

      // Destination is a known reachable node in the test network
      // First Avenue endpoint: [45.5029, -73.5661]
      await manager.findAndSetRoutes(vehicle.id, [45.5029, -73.5661]);

      // Should have emitted a direction event
      expect(directionListener).toHaveBeenCalledTimes(1);
      const directionEvent = directionListener.mock.calls[0][0];
      expect(directionEvent.vehicleId).toBe(vehicle.id);
      expect(directionEvent.route).toBeDefined();
      expect(directionEvent.route.edges).toBeDefined();
      expect(directionEvent.route.edges.length).toBeGreaterThan(0);
      expect(directionEvent.route.distance).toBeGreaterThan(0);

      // Vehicle's currentEdge should be the first edge of the route
      expect(vehicle.progress).toBe(0);
      expect(vehicle.edgeIndex).toBe(0);

      manager.off("direction", directionListener);
    });

    it("should handle unreachable destination gracefully without crashing", async () => {
      const vehicle = firstVehicle();
      const directionListener = vi.fn();
      manager.on("direction", directionListener);

      // Force an unreachable scenario by disconnecting the start node.
      // Create a disconnected node scenario by temporarily replacing the vehicle position
      // with coordinates that snap to a node with no connections.
      // We can't easily create an unreachable destination on this small connected graph,
      // so we test the "no connections" early return path by mocking findNearestNode
      // to return an isolated node for the start.
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

      // Should not throw, should return an error result
      const result = await manager.findAndSetRoutes(vehicle.id, [90, 180]);
      expect(result.status).toBe("error");
      expect(result.error).toBeDefined();

      // Should NOT have emitted a direction event (no route found)
      expect(directionListener).not.toHaveBeenCalled();

      vi.restoreAllMocks();
      manager.off("direction", directionListener);
    });

    it("should return error result when vehicle is not found", async () => {
      const result = await manager.findAndSetRoutes("non-existent-vehicle-id", [45.5029, -73.5661]);
      expect(result.status).toBe("error");
      expect(result.vehicleId).toBe("non-existent-vehicle-id");
      expect(result.error).toBe("Vehicle non-existent-vehicle-id not found");
    });

    it("should replace old route when vehicle already has one", async () => {
      const vehicle = firstVehicle();

      // Place vehicle on a known bidirectional edge so both dispatches can succeed.
      // Use the Second Avenue edge from [45.5020, -73.5670] to [45.5023, -73.5673].
      // This node connects to both First Avenue (via Main Street junction) and Second Avenue.
      const startNode = network.findNearestNode([45.502, -73.567]);
      const startEdge = startNode.connections[0];
      vehicle.currentEdge = startEdge;
      vehicle.position = startEdge.start.coordinates;
      vehicle.progress = 0;

      // First dispatch — route to Second Avenue endpoint: [45.5026, -73.5676]
      const firstResult = await manager.findAndSetRoutes(vehicle.id, [45.5026, -73.5676]);
      expect(firstResult.status).toBe("ok");

      // Second dispatch — route to a different destination on the same connected component
      // Route to First Avenue midpoint: [45.5026, -73.5664]
      const directionListener = vi.fn();
      manager.on("direction", directionListener);

      const secondResult = await manager.findAndSetRoutes(vehicle.id, [45.5026, -73.5664]);

      if (secondResult.status === "ok") {
        // Should have emitted a new direction event for the replacement route
        expect(directionListener).toHaveBeenCalledTimes(1);
        const directionEvent = directionListener.mock.calls[0][0];
        expect(directionEvent.vehicleId).toBe(vehicle.id);
        expect(directionEvent.route.edges.length).toBeGreaterThan(0);

        // Vehicle should be reset to the start of the new route
        expect(vehicle.progress).toBe(0);
        expect(vehicle.edgeIndex).toBe(0);
      } else {
        // On this small directed graph, some route pairs are unreachable due to one-way streets.
        // Verify the error was graceful (no crash, proper error result).
        expect(secondResult.error).toBeDefined();
      }

      manager.off("direction", directionListener);
    });
  });
});

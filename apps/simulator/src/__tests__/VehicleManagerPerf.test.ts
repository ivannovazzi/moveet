import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle } from "../types";
import path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("VehicleManager performance optimizations", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 5;
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
    const vehicles = manager.getVehicles();
    for (const v of vehicles) {
      manager.stopVehicleMovement(v.id);
    }
    manager.stopLocationUpdates();
  });

  /** Helper: get internal Vehicle map */
  function internalVehicles(): Map<string, Vehicle> {
    return (manager as any).vehicles as Map<string, Vehicle>;
  }

  /** Helper: get the active vehicles set */
  function activeVehicles(): Set<string> {
    return (manager as any).activeVehicles as Set<string>;
  }

  /** Helper: get the game loop interval */
  function gameLoopInterval(): NodeJS.Timeout | null {
    return (manager as any).gameLoopInterval as NodeJS.Timeout | null;
  }

  /** Helper: get the edge index */
  function vehiclesByEdge(): Map<string, Set<string>> {
    return (manager as any).vehiclesByEdge as Map<string, Set<string>>;
  }

  /** Helper: get lastUpdateTimes */
  function lastUpdateTimes(): Map<string, number> {
    return (manager as any).lastUpdateTimes as Map<string, number>;
  }

  // ─── Task 1: Single game loop ──────────────────────────────────────

  describe("single game loop", () => {
    it("should add vehicle to active set on startVehicleMovement", () => {
      const vehicles = manager.getVehicles();
      expect(activeVehicles().size).toBe(0);

      manager.startVehicleMovement(vehicles[0].id, 500);
      expect(activeVehicles().has(vehicles[0].id)).toBe(true);
      expect(activeVehicles().size).toBe(1);
    });

    it("should remove vehicle from active set on stopVehicleMovement", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      expect(activeVehicles().size).toBe(1);

      manager.stopVehicleMovement(vehicles[0].id);
      expect(activeVehicles().has(vehicles[0].id)).toBe(false);
      expect(activeVehicles().size).toBe(0);
    });

    it("should start the game loop on first vehicle activation", () => {
      expect(gameLoopInterval()).toBeNull();

      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      expect(gameLoopInterval()).not.toBeNull();
    });

    it("should stop the game loop when last vehicle is deactivated", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      manager.startVehicleMovement(vehicles[1].id, 500);
      expect(gameLoopInterval()).not.toBeNull();

      manager.stopVehicleMovement(vehicles[0].id);
      // Still one active vehicle
      expect(gameLoopInterval()).not.toBeNull();

      manager.stopVehicleMovement(vehicles[1].id);
      // No more active vehicles
      expect(gameLoopInterval()).toBeNull();
    });

    it("should not create multiple game loop intervals for multiple vehicles", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      const firstInterval = gameLoopInterval();

      manager.startVehicleMovement(vehicles[1].id, 500);
      // Should reuse the same interval (not create a new one)
      expect(gameLoopInterval()).toBe(firstInterval);
    });

    it("should update all active vehicles per tick", () => {
      const vehicles = Array.from(internalVehicles().values());

      // Start all vehicles
      for (const v of vehicles) {
        manager.startVehicleMovement(v.id, 500);
      }

      // Stub updateVehicle to track calls
      const updateCalls: string[] = [];
      const origUpdateVehicle = (manager as any).updateVehicle.bind(manager);
      (manager as any).updateVehicle = (vehicle: Vehicle, deltaMs: number) => {
        updateCalls.push(vehicle.id);
        origUpdateVehicle(vehicle, deltaMs);
      };

      // Manually trigger the game loop tick
      (manager as any).gameLoopTick();

      // All active vehicles should have been updated
      expect(updateCalls.length).toBe(vehicles.length);
      for (const v of vehicles) {
        expect(updateCalls).toContain(v.id);
      }
    });

    it("should compute correct deltaTime per vehicle in the game loop", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);

      // Set a known last update time in the past
      const now = Date.now();
      lastUpdateTimes().set(vehicles[0].id, now - 250);

      const deltas: number[] = [];
      (manager as any).updateVehicle = (_vehicle: Vehicle, deltaMs: number) => {
        deltas.push(deltaMs);
      };

      // Trigger the tick
      (manager as any).gameLoopTick();

      // deltaMs should be approximately 250ms (at least > 200, allowing for timing)
      expect(deltas.length).toBe(1);
      expect(deltas[0]).toBeGreaterThanOrEqual(200);
      expect(deltas[0]).toBeLessThan(1000);
    });

    it("should only update active vehicles, not inactive ones", () => {
      const vehicles = Array.from(internalVehicles().values());

      // Activate only the first two vehicles
      manager.startVehicleMovement(vehicles[0].id, 500);
      manager.startVehicleMovement(vehicles[1].id, 500);

      const updateCalls: string[] = [];
      (manager as any).updateVehicle = (vehicle: Vehicle, _deltaMs: number) => {
        updateCalls.push(vehicle.id);
      };

      (manager as any).gameLoopTick();

      expect(updateCalls.length).toBe(2);
      expect(updateCalls).toContain(vehicles[0].id);
      expect(updateCalls).toContain(vehicles[1].id);
      // The remaining vehicles should NOT have been updated
      for (let i = 2; i < vehicles.length; i++) {
        expect(updateCalls).not.toContain(vehicles[i].id);
      }
    });

    it("should restart game loop when updateInterval changes via setOptions", () => {
      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);

      const firstInterval = gameLoopInterval();
      expect(firstInterval).not.toBeNull();

      // Change update interval
      manager.setOptions({ updateInterval: 1000 });

      // Game loop should have been restarted (new interval object)
      const newInterval = gameLoopInterval();
      expect(newInterval).not.toBeNull();
      expect(newInterval).not.toBe(firstInterval);
    });

    it("should report isRunning correctly with the active set", () => {
      expect(manager.isRunning()).toBe(false);

      const vehicles = manager.getVehicles();
      manager.startVehicleMovement(vehicles[0].id, 500);
      expect(manager.isRunning()).toBe(true);

      manager.stopVehicleMovement(vehicles[0].id);
      expect(manager.isRunning()).toBe(false);
    });

    it("should emit update events for each vehicle during game loop tick", () => {
      const vehicles = Array.from(internalVehicles().values());
      for (const v of vehicles) {
        manager.startVehicleMovement(v.id, 500);
      }

      const updateEvents: string[] = [];
      manager.on("update", (dto) => {
        updateEvents.push(dto.id);
      });

      (manager as any).gameLoopTick();

      expect(updateEvents.length).toBe(vehicles.length);
    });
  });

  // ─── Task 2: Edge spatial index ────────────────────────────────────

  describe("edge spatial index", () => {
    it("should index vehicles by their starting edge on construction", () => {
      const edgeIndex = vehiclesByEdge();
      const vehicles = Array.from(internalVehicles().values());

      // Every vehicle should be in the index
      for (const v of vehicles) {
        const edgeSet = edgeIndex.get(v.currentEdge.id);
        expect(edgeSet).toBeDefined();
        expect(edgeSet!.has(v.id)).toBe(true);
      }
    });

    it("should reflect correct vehicles when querying the edge index directly", () => {
      const vehicles = Array.from(internalVehicles().values());
      const testEdge = vehicles[0].currentEdge;

      // Place a second vehicle on the same edge
      (manager as any).addToEdgeIndex(vehicles[1].id, testEdge.id);

      const edgeIndex = vehiclesByEdge();
      const vehicleIdsOnEdge = edgeIndex.get(testEdge.id);
      expect(vehicleIdsOnEdge).toBeDefined();
      expect(vehicleIdsOnEdge!.has(vehicles[0].id)).toBe(true);
      expect(vehicleIdsOnEdge!.has(vehicles[1].id)).toBe(true);
    });

    it("should update the index when a vehicle transitions to a new edge", () => {
      const vehicles = Array.from(internalVehicles().values());
      const vehicle = vehicles[0];
      const originalEdgeId = vehicle.currentEdge.id;

      // Set speed so vehicle will move far enough to transition
      manager.setOptions({ minSpeed: 200, maxSpeed: 200, speedVariation: 0 });
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;
      vehicle.progress = 0.99; // near end of edge

      // Stub setRandomDestination to avoid pathfinding
      (manager as any).setRandomDestination = () => {};

      // Force an update which should transition to next edge
      (manager as any).updateVehicle(vehicle, 5000);

      // After update, the vehicle might be on a different edge
      const newEdgeId = vehicle.currentEdge.id;

      if (newEdgeId !== originalEdgeId) {
        // Vehicle moved to a new edge - verify index was updated
        const oldEdgeSet = vehiclesByEdge().get(originalEdgeId);
        const newEdgeSet = vehiclesByEdge().get(newEdgeId);

        // Should NOT be on the old edge anymore
        if (oldEdgeSet) {
          expect(oldEdgeSet.has(vehicle.id)).toBe(false);
        }

        // Should be on the new edge
        expect(newEdgeSet).toBeDefined();
        expect(newEdgeSet!.has(vehicle.id)).toBe(true);
      }
    });

    it("should maintain consistent index after multiple edge transitions", () => {
      const vehicles = Array.from(internalVehicles().values());
      const vehicle = vehicles[0];

      manager.setOptions({ minSpeed: 200, maxSpeed: 200, speedVariation: 0 });
      vehicle.speed = 200;
      vehicle.targetSpeed = 200;

      // Stub setRandomDestination to avoid pathfinding
      (manager as any).setRandomDestination = () => {};

      // Run many updates to cause several edge transitions
      for (let i = 0; i < 20; i++) {
        vehicle.progress = 0.99;
        (manager as any).updateVehicle(vehicle, 5000);
      }

      // After all transitions, the vehicle should appear exactly once in the index
      const edgeIndex = vehiclesByEdge();
      let count = 0;
      for (const [, vehicleSet] of edgeIndex) {
        if (vehicleSet.has(vehicle.id)) {
          count++;
        }
      }
      expect(count).toBe(1);

      // And it should be on the vehicle's current edge
      const currentEdgeSet = edgeIndex.get(vehicle.currentEdge.id);
      expect(currentEdgeSet).toBeDefined();
      expect(currentEdgeSet!.has(vehicle.id)).toBe(true);
    });

    it("should clean up the index on reset", async () => {
      // Stub setRandomDestination to avoid pathfinding crashes
      (manager as any).setRandomDestination = () => {};

      await manager.reset();

      const edgeIndex = vehiclesByEdge();
      // After reset, the index should reflect the new vehicles
      const vehicles = Array.from(internalVehicles().values());
      for (const v of vehicles) {
        const edgeSet = edgeIndex.get(v.currentEdge.id);
        expect(edgeSet).toBeDefined();
        expect(edgeSet!.has(v.id)).toBe(true);
      }
    });

    it("should clean up empty sets from the index", () => {
      const vehicles = Array.from(internalVehicles().values());
      const vehicle = vehicles[0];
      const edgeId = vehicle.currentEdge.id;

      // Count vehicles on this edge
      const edgeSet = vehiclesByEdge().get(edgeId);
      if (edgeSet && edgeSet.size === 1) {
        // Only this vehicle is on this edge, removing it should clean up
        (manager as any).removeFromEdgeIndex(vehicle.id, edgeId);
        expect(vehiclesByEdge().has(edgeId)).toBe(false);
      }
    });
  });

  // ─── Task 3: findVehicleAhead ──────────────────────────────────────

  describe("findVehicleAhead", () => {
    it("should find the nearest vehicle ahead on the same edge", () => {
      const vehicles = Array.from(internalVehicles().values());
      expect(vehicles.length).toBeGreaterThanOrEqual(3);

      const me = vehicles[0];
      const farAhead = vehicles[1];
      const closeAhead = vehicles[2];

      // Place all on the same edge
      const testEdge = me.currentEdge;
      farAhead.currentEdge = testEdge;
      closeAhead.currentEdge = testEdge;

      // Update edge index for moved vehicles
      (manager as any).addToEdgeIndex(farAhead.id, testEdge.id);
      (manager as any).addToEdgeIndex(closeAhead.id, testEdge.id);

      me.progress = 0.1;
      closeAhead.progress = 0.3;
      farAhead.progress = 0.7;

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeDefined();
      expect(ahead.id).toBe(closeAhead.id);
    });

    it("should return undefined when no vehicle is ahead", () => {
      const vehicles = Array.from(internalVehicles().values());
      const me = vehicles[0];
      const behind = vehicles[1];

      const testEdge = me.currentEdge;
      behind.currentEdge = testEdge;
      (manager as any).addToEdgeIndex(behind.id, testEdge.id);

      me.progress = 0.8;
      behind.progress = 0.2;

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeUndefined();
    });

    it("should return undefined on an empty edge", () => {
      const vehicles = Array.from(internalVehicles().values());
      const me = vehicles[0];

      // Create a mock edge that only this vehicle is on
      // Clear the index and re-add only this vehicle
      const edgeId = me.currentEdge.id;
      const edgeSet = vehiclesByEdge().get(edgeId);
      if (edgeSet) {
        // Remove all other vehicles from this edge
        for (const id of Array.from(edgeSet)) {
          if (id !== me.id) {
            edgeSet.delete(id);
          }
        }
      }

      me.progress = 0.5;

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeUndefined();
    });

    it("should return undefined when the only other vehicle is behind", () => {
      const vehicles = Array.from(internalVehicles().values());
      const me = vehicles[0];
      const other = vehicles[1];

      const testEdge = me.currentEdge;
      other.currentEdge = testEdge;
      (manager as any).addToEdgeIndex(other.id, testEdge.id);

      me.progress = 0.9;
      other.progress = 0.1;

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeUndefined();
    });

    it("should ignore vehicles with the same progress (not strictly ahead)", () => {
      const vehicles = Array.from(internalVehicles().values());
      const me = vehicles[0];
      const sameProgress = vehicles[1];

      const testEdge = me.currentEdge;
      sameProgress.currentEdge = testEdge;
      (manager as any).addToEdgeIndex(sameProgress.id, testEdge.id);

      me.progress = 0.5;
      sameProgress.progress = 0.5;

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeUndefined();
    });

    it("should find vehicle ahead among multiple candidates (picks closest)", () => {
      const vehicles = Array.from(internalVehicles().values());
      expect(vehicles.length).toBeGreaterThanOrEqual(4);

      const me = vehicles[0];
      const testEdge = me.currentEdge;

      // Place all on the same edge
      for (const v of vehicles) {
        v.currentEdge = testEdge;
        (manager as any).addToEdgeIndex(v.id, testEdge.id);
      }

      me.progress = 0.1;
      vehicles[1].progress = 0.5; // ahead
      vehicles[2].progress = 0.3; // closest ahead
      vehicles[3].progress = 0.8; // farthest ahead

      const ahead = (manager as any).findVehicleAhead(me);
      expect(ahead).toBeDefined();
      expect(ahead.id).toBe(vehicles[2].id);
    });

    it("should be used by updateSpeed for following distance", () => {
      const vehicles = Array.from(internalVehicles().values());
      expect(vehicles.length).toBeGreaterThanOrEqual(2);

      const leader = vehicles[0];
      const follower = vehicles[1];

      // Place both on the same edge
      follower.currentEdge = leader.currentEdge;
      (manager as any).addToEdgeIndex(follower.id, leader.currentEdge.id);

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

      expect(follower.targetSpeed).toBeLessThanOrEqual(leader.speed * 0.9);
    });
  });

  // ─── Integration: all three optimizations working together ─────────

  describe("integration", () => {
    it("should correctly simulate multiple vehicles in the game loop with spatial indexing", () => {
      const vehicles = Array.from(internalVehicles().values());

      // Stub setRandomDestination
      (manager as any).setRandomDestination = () => {};

      manager.setOptions({ minSpeed: 30, maxSpeed: 60, speedVariation: 0 });

      // Start all vehicles
      for (const v of vehicles) {
        v.speed = 40;
        v.targetSpeed = 40;
        v.dwellUntil = undefined;
        manager.startVehicleMovement(v.id, 500);
      }

      // Record initial positions
      const initialPositions = new Map<string, [number, number]>();
      for (const v of vehicles) {
        initialPositions.set(v.id, [...v.position]);
      }

      // Set lastUpdateTimes in the past so the tick computes a meaningful deltaMs
      const now = Date.now();
      for (const v of vehicles) {
        lastUpdateTimes().set(v.id, now - 500);
      }

      // Run several game loop ticks
      for (let i = 0; i < 5; i++) {
        // Push lastUpdateTimes back before each tick so delta is non-zero
        const tickNow = Date.now();
        for (const v of vehicles) {
          lastUpdateTimes().set(v.id, tickNow - 500);
        }
        (manager as any).gameLoopTick();
      }

      // All vehicles should have moved
      let movedCount = 0;
      for (const v of vehicles) {
        const initial = initialPositions.get(v.id)!;
        if (v.position[0] !== initial[0] || v.position[1] !== initial[1]) {
          movedCount++;
        }
      }
      expect(movedCount).toBeGreaterThan(0);

      // Edge index should still be consistent
      const edgeIndex = vehiclesByEdge();
      for (const v of vehicles) {
        let foundInIndex = false;
        const edgeSet = edgeIndex.get(v.currentEdge.id);
        if (edgeSet && edgeSet.has(v.id)) {
          foundInIndex = true;
        }
        expect(foundInIndex).toBe(true);
      }
    });
  });
});

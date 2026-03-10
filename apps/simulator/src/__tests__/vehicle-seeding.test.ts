import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle } from "../types";
import path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("Vehicle seed position", () => {
  let network: RoadNetwork;
  let manager: VehicleManager;
  let origVehicleCount: number;
  let origAdapterURL: string;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    origAdapterURL = config.adapterURL;
    (config as any).vehicleCount = 2;
    (config as any).adapterURL = "";

    network = new RoadNetwork(FIXTURE_PATH);

    // Stub setRandomDestination before constructor runs to prevent
    // crashes from empty-edge routes on the tiny test network.
    const origProto = VehicleManager.prototype as any;
    const origSetRandom = origProto.setRandomDestination;
    origProto.setRandomDestination = function () {
      // no-op: skip pathfinding during init
    };

    manager = new VehicleManager(network);

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

  /** Helper: get internal Vehicle map for accessing private state */
  function internalVehicles(): Map<string, Vehicle> {
    return (manager as any).vehicles as Map<string, Vehicle>;
  }

  /** Helper: call the private addVehicle method directly */
  function callAddVehicle(id: string, name: string, seedPosition?: [number, number]): void {
    // Stub setRandomDestination to prevent route-finding on tiny network
    const origSetRandom = (manager as any).setRandomDestination;
    (manager as any).setRandomDestination = () => {};
    (manager as any).addVehicle(id, name, seedPosition);
    (manager as any).setRandomDestination = origSetRandom;
  }

  describe("with seed position", () => {
    it("should start vehicle on an edge connected to the nearest node", () => {
      // Use a known node coordinate from the test fixture: [45.5017, -73.5673]
      const seedPosition: [number, number] = [45.5017, -73.5673];
      const nearestNode = network.findNearestNode(seedPosition);

      callAddVehicle("seeded-1", "Seeded Vehicle", seedPosition);

      const vehicle = internalVehicles().get("seeded-1");
      expect(vehicle).toBeDefined();

      // The vehicle's starting edge should be one of the connections from the nearest node
      const connectedEdgeIds = nearestNode.connections.map((e) => e.id);
      expect(connectedEdgeIds).toContain(vehicle!.currentEdge.id);
    });

    it("should start vehicle at the start coordinates of the seeded edge", () => {
      const seedPosition: [number, number] = [45.502, -73.567];

      callAddVehicle("seeded-2", "Seeded Vehicle 2", seedPosition);

      const vehicle = internalVehicles().get("seeded-2");
      expect(vehicle).toBeDefined();
      expect(vehicle!.progress).toBe(0);
      expect(vehicle!.position[0]).toBe(vehicle!.currentEdge.start.coordinates[0]);
      expect(vehicle!.position[1]).toBe(vehicle!.currentEdge.start.coordinates[1]);
    });

    it("should pick edge near the seed position, not a random one", () => {
      // Seed near [45.5029, -73.5661] (end of First Avenue)
      const seedPosition: [number, number] = [45.5029, -73.5661];
      const nearestNode = network.findNearestNode(seedPosition);

      // Spy on getRandomEdge to confirm it is NOT called
      const randomEdgeSpy = vi.spyOn(network, "getRandomEdge");

      callAddVehicle("seeded-3", "Seeded Vehicle 3", seedPosition);

      expect(randomEdgeSpy).not.toHaveBeenCalled();

      const vehicle = internalVehicles().get("seeded-3");
      expect(vehicle).toBeDefined();

      const connectedEdgeIds = nearestNode.connections.map((e) => e.id);
      expect(connectedEdgeIds).toContain(vehicle!.currentEdge.id);

      randomEdgeSpy.mockRestore();
    });
  });

  describe("without seed position", () => {
    it("should use getRandomEdge when no seed position is provided", () => {
      const randomEdgeSpy = vi.spyOn(network, "getRandomEdge");

      callAddVehicle("random-1", "Random Vehicle");

      expect(randomEdgeSpy).toHaveBeenCalled();
      randomEdgeSpy.mockRestore();
    });

    it("should create vehicle with valid position and progress 0", () => {
      callAddVehicle("random-2", "Random Vehicle 2");

      const vehicle = internalVehicles().get("random-2");
      expect(vehicle).toBeDefined();
      expect(vehicle!.progress).toBe(0);
      expect(vehicle!.position[0]).toBe(vehicle!.currentEdge.start.coordinates[0]);
      expect(vehicle!.position[1]).toBe(vehicle!.currentEdge.start.coordinates[1]);
    });
  });

  describe("fallback for invalid/extreme coordinates", () => {
    it("should fall back gracefully when seed position is far from the network", () => {
      // Coordinates far from the test fixture (different hemisphere)
      const farPosition: [number, number] = [0.0, 0.0];

      callAddVehicle("far-1", "Far Vehicle", farPosition);

      const vehicle = internalVehicles().get("far-1");
      expect(vehicle).toBeDefined();
      // Vehicle should still have a valid edge, even if it's the nearest one to [0,0]
      expect(vehicle!.currentEdge).toBeDefined();
      expect(vehicle!.currentEdge.start).toBeDefined();
      expect(vehicle!.currentEdge.end).toBeDefined();
      expect(vehicle!.progress).toBe(0);
    });

    it("should fall back to random edge when nearest node has no connections", () => {
      // Mock findNearestNode to return a node with no connections
      const isolatedNode = {
        id: "isolated",
        coordinates: [0, 0] as [number, number],
        connections: [],
      };
      const findNearestSpy = vi.spyOn(network, "findNearestNode").mockReturnValue(isolatedNode);
      const randomEdgeSpy = vi.spyOn(network, "getRandomEdge");

      callAddVehicle("isolated-1", "Isolated Vehicle", [0, 0]);

      expect(findNearestSpy).toHaveBeenCalled();
      expect(randomEdgeSpy).toHaveBeenCalled();

      const vehicle = internalVehicles().get("isolated-1");
      expect(vehicle).toBeDefined();
      expect(vehicle!.currentEdge).toBeDefined();

      findNearestSpy.mockRestore();
      randomEdgeSpy.mockRestore();
    });
  });
});

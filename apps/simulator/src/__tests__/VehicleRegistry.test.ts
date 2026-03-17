import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import { getProfile } from "../utils/vehicleProfiles";
import path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("VehicleRegistry", () => {
  let network: RoadNetwork;
  let registry: VehicleRegistry;
  let origVehicleCount: number;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    (config as any).vehicleCount = 3;
    network = new RoadNetwork(FIXTURE_PATH);
    registry = new VehicleRegistry(network, new FleetManager());
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
  });

  // ─── Vehicle loading ──────────────────────────────────────────────

  describe("loadFromData", () => {
    it("should load default vehicle count when no types specified", () => {
      registry.loadFromData();
      expect(registry.getAll().size).toBe(3);
    });

    it("should load specified vehicle types and counts", () => {
      registry.loadFromData({ car: 2, truck: 1 });
      const vehicles = Array.from(registry.getAll().values());
      expect(vehicles).toHaveLength(3);
      expect(vehicles.filter((v) => v.type === "car")).toHaveLength(2);
      expect(vehicles.filter((v) => v.type === "truck")).toHaveLength(1);
    });

    it("should fall back to config.vehicleCount when vehicleTypes is empty", () => {
      registry.loadFromData({});
      expect(registry.getAll().size).toBe(3);
    });

    it("should invoke onVehicleAdded callback for each vehicle", () => {
      const added: string[] = [];
      registry.loadFromData(undefined, (id) => added.push(id));
      expect(added).toHaveLength(3);
    });
  });

  // ─── addVehicle ───────────────────────────────────────────────────

  describe("addVehicle", () => {
    it("should add a vehicle with valid position and edge", () => {
      registry.addVehicle("v1", "Vehicle 1");
      const vehicle = registry.get("v1");
      expect(vehicle).toBeDefined();
      expect(vehicle!.id).toBe("v1");
      expect(vehicle!.name).toBe("Vehicle 1");
      expect(vehicle!.currentEdge).toBeDefined();
      expect(vehicle!.position).toHaveLength(2);
      expect(vehicle!.progress).toBe(0);
    });

    it("should assign correct type and profile speed", () => {
      registry.addVehicle("v1", "Truck 1", undefined, "truck");
      const vehicle = registry.get("v1")!;
      expect(vehicle.type).toBe("truck");
      expect(vehicle.speed).toBe(getProfile("truck").minSpeed);
    });

    it("should default to car type", () => {
      registry.addVehicle("v1", "V1");
      expect(registry.get("v1")!.type).toBe("car");
    });

    it("should use seed position to find nearest edge", () => {
      registry.addVehicle("v1", "V1", [45.502, -73.567]);
      const vehicle = registry.get("v1")!;
      // Should be placed on an edge connected to the nearest node
      expect(vehicle.currentEdge).toBeDefined();
    });

    it("should invoke onVehicleAdded callback", () => {
      let callbackId: string | undefined;
      registry.addVehicle("v1", "V1", undefined, "car", (id) => {
        callbackId = id;
      });
      expect(callbackId).toBe("v1");
    });
  });

  // ─── has / get / getAll ───────────────────────────────────────────

  describe("has/get/getAll", () => {
    beforeEach(() => {
      registry.loadFromData();
    });

    it("should return true for existing vehicle", () => {
      expect(registry.has("0")).toBe(true);
    });

    it("should return false for non-existent vehicle", () => {
      expect(registry.has("non-existent")).toBe(false);
    });

    it("should return vehicle for existing id", () => {
      const v = registry.get("0");
      expect(v).toBeDefined();
      expect(v!.id).toBe("0");
    });

    it("should return undefined for non-existent id", () => {
      expect(registry.get("non-existent")).toBeUndefined();
    });

    it("should return all vehicles", () => {
      expect(registry.getAll().size).toBe(3);
    });
  });

  // ─── getAllSerialized ─────────────────────────────────────────────

  describe("getAllSerialized", () => {
    it("should return VehicleDTO objects without internal fields", () => {
      registry.loadFromData();
      const dtos = registry.getAllSerialized();
      expect(dtos).toHaveLength(3);
      for (const dto of dtos) {
        expect(dto).toHaveProperty("id");
        expect(dto).toHaveProperty("name");
        expect(dto).toHaveProperty("position");
        expect(dto).toHaveProperty("speed");
        expect(dto).toHaveProperty("heading");
        expect(dto).not.toHaveProperty("currentEdge");
        expect(dto).not.toHaveProperty("progress");
      }
    });
  });

  // ─── Edge spatial index ───────────────────────────────────────────

  describe("edge spatial index", () => {
    beforeEach(() => {
      registry.loadFromData();
    });

    it("should index vehicles by their starting edge on construction", () => {
      const vehicles = Array.from(registry.getAll().values());
      for (const v of vehicles) {
        const edgeSet = registry.getVehiclesOnEdge(v.currentEdge.id);
        expect(edgeSet).toBeDefined();
        expect(edgeSet!.has(v.id)).toBe(true);
      }
    });

    it("should add a vehicle to the edge index", () => {
      registry.addToEdgeIndex("test-vehicle", "test-edge");
      const edgeSet = registry.getVehiclesOnEdge("test-edge");
      expect(edgeSet).toBeDefined();
      expect(edgeSet!.has("test-vehicle")).toBe(true);
    });

    it("should remove a vehicle from the edge index", () => {
      registry.addToEdgeIndex("test-vehicle", "test-edge");
      registry.removeFromEdgeIndex("test-vehicle", "test-edge");
      expect(registry.getVehiclesOnEdge("test-edge")).toBeUndefined();
    });

    it("should move a vehicle between edges in the index", () => {
      registry.addToEdgeIndex("test-vehicle", "edge-a");
      registry.moveInEdgeIndex("test-vehicle", "edge-a", "edge-b");
      expect(registry.getVehiclesOnEdge("edge-a")).toBeUndefined();
      const edgeB = registry.getVehiclesOnEdge("edge-b");
      expect(edgeB).toBeDefined();
      expect(edgeB!.has("test-vehicle")).toBe(true);
    });

    it("should clean up empty sets from the index", () => {
      registry.addToEdgeIndex("v1", "edge-x");
      registry.removeFromEdgeIndex("v1", "edge-x");
      expect(registry.getVehiclesByEdge().has("edge-x")).toBe(false);
    });
  });

  // ─── findVehicleAhead ─────────────────────────────────────────────

  describe("findVehicleAhead", () => {
    beforeEach(() => {
      registry.loadFromData();
    });

    it("should find the nearest vehicle ahead on the same edge", () => {
      const vehicles = Array.from(registry.getAll().values());
      const me = vehicles[0];
      const ahead = vehicles[1];
      const farAhead = vehicles[2];

      // Place all on same edge
      ahead.currentEdge = me.currentEdge;
      farAhead.currentEdge = me.currentEdge;
      registry.addToEdgeIndex(ahead.id, me.currentEdge.id);
      registry.addToEdgeIndex(farAhead.id, me.currentEdge.id);

      me.progress = 0.1;
      ahead.progress = 0.3;
      farAhead.progress = 0.7;

      const found = registry.findVehicleAhead(me);
      expect(found).toBeDefined();
      expect(found!.id).toBe(ahead.id);
    });

    it("should return undefined when no vehicle is ahead", () => {
      const vehicles = Array.from(registry.getAll().values());
      const me = vehicles[0];
      const behind = vehicles[1];

      behind.currentEdge = me.currentEdge;
      registry.addToEdgeIndex(behind.id, me.currentEdge.id);

      me.progress = 0.8;
      behind.progress = 0.2;

      expect(registry.findVehicleAhead(me)).toBeUndefined();
    });

    it("should return undefined for a lone vehicle on an edge", () => {
      const vehicles = Array.from(registry.getAll().values());
      const me = vehicles[0];
      const edgeId = me.currentEdge.id;

      // Remove other vehicles from this edge
      const edgeSet = registry.getVehiclesOnEdge(edgeId);
      if (edgeSet) {
        for (const id of Array.from(edgeSet)) {
          if (id !== me.id) edgeSet.delete(id);
        }
      }

      me.progress = 0.5;
      expect(registry.findVehicleAhead(me)).toBeUndefined();
    });
  });

  // ─── reset ────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should clear all vehicle state", () => {
      registry.loadFromData();
      expect(registry.getAll().size).toBe(3);

      registry.reset();
      expect(registry.getAll().size).toBe(0);
      expect(registry.getVehiclesByEdge().size).toBe(0);
    });

    it("should allow re-loading vehicles after reset", () => {
      registry.loadFromData();
      registry.reset();
      registry.loadFromData({ truck: 2 });
      expect(registry.getAll().size).toBe(2);
      for (const v of registry.getAll().values()) {
        expect(v.type).toBe("truck");
      }
    });
  });
});

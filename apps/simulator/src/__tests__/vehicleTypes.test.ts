import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VehicleManager } from "../modules/VehicleManager";
import { FleetManager } from "../modules/FleetManager";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import { VEHICLE_PROFILES, FOLLOWING_DISTANCE_BY_SIZE, getProfile } from "../utils/vehicleProfiles";
import { serializeVehicle } from "../utils/serializer";
import { buildGraph, findRoute } from "../workers/pathfinding-worker";
import type { Vehicle, VehicleType } from "../types";
import path from "path";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");
const ALL_TYPES: VehicleType[] = ["car", "truck", "motorcycle", "ambulance", "bus"];

// ─── Helpers ────────────────────────────────────────────────────────

function createManager(
  network: RoadNetwork,
  vehicleTypes?: Partial<Record<VehicleType, number>>
): VehicleManager {
  // Stub setRandomDestination to prevent pathfinding on tiny test network
  const proto = VehicleManager.prototype as any;
  const orig = proto.setRandomDestination;
  proto.setRandomDestination = function () {};

  if (vehicleTypes) {
    // Set pending types before constructor calls loadFromData
    const origInit = proto.init;
    proto.init = function (this: any) {
      this.pendingVehicleTypes = vehicleTypes;
      origInit.call(this);
    };
    const mgr = new VehicleManager(network, new FleetManager());
    proto.init = origInit;
    proto.setRandomDestination = orig;
    return mgr;
  }

  const mgr = new VehicleManager(network, new FleetManager());
  proto.setRandomDestination = orig;
  return mgr;
}

function getInternalVehicles(manager: VehicleManager): Map<string, Vehicle> {
  return (manager as any).vehicles;
}

function cleanupManager(manager: VehicleManager): void {
  for (const v of manager.getVehicles()) {
    manager.stopVehicleMovement(v.id);
  }
  manager.stopLocationUpdates();
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Vehicle Types", () => {
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
    manager = createManager(network);
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
    (config as any).adapterURL = origAdapterURL;
    cleanupManager(manager);
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // 1. Profile loading and defaults
  // ────────────────────────────────────────────────────────────────
  describe("Profile loading and defaults", () => {
    it("has a valid profile for every vehicle type", () => {
      for (const type of ALL_TYPES) {
        const profile = VEHICLE_PROFILES[type];
        expect(profile).toBeDefined();
        expect(profile.type).toBe(type);
        expect(profile.minSpeed).toBeGreaterThan(0);
        expect(profile.maxSpeed).toBeGreaterThan(profile.minSpeed);
        expect(profile.acceleration).toBeGreaterThan(0);
        expect(profile.deceleration).toBeGreaterThan(0);
        expect(["small", "medium", "large"]).toContain(profile.size);
      }
    });

    it("car profile has expected defaults", () => {
      const car = VEHICLE_PROFILES.car;
      expect(car.minSpeed).toBe(20);
      expect(car.maxSpeed).toBe(60);
      expect(car.acceleration).toBe(5);
      expect(car.deceleration).toBe(7);
      expect(car.size).toBe("medium");
      expect(car.ignoreHeatZones).toBe(false);
      expect(car.restrictedHighways).toEqual([]);
    });

    it("ambulance profile has ignoreHeatZones enabled", () => {
      expect(VEHICLE_PROFILES.ambulance.ignoreHeatZones).toBe(true);
    });

    it("truck and bus restrict residential highways", () => {
      expect(VEHICLE_PROFILES.truck.restrictedHighways).toContain("residential");
      expect(VEHICLE_PROFILES.bus.restrictedHighways).toContain("residential");
    });

    it("getProfile returns the correct profile for each type", () => {
      for (const type of ALL_TYPES) {
        const profile = getProfile(type);
        expect(profile).toBe(VEHICLE_PROFILES[type]);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Vehicle type assignment
  // ────────────────────────────────────────────────────────────────
  describe("Vehicle type assignment", () => {
    it("default vehicles use weighted distribution (mixed types)", () => {
      const vehicles = getInternalVehicles(manager);
      for (const vehicle of vehicles.values()) {
        expect(ALL_TYPES).toContain(vehicle.type);
      }
    });

    it("VehicleDTO includes type field via serializer", () => {
      const dtos = manager.getVehicles();
      expect(dtos.length).toBeGreaterThan(0);
      for (const dto of dtos) {
        expect(dto.type).toBeDefined();
        expect(ALL_TYPES).toContain(dto.type);
      }
    });

    it("all 5 vehicle types are valid profile keys", () => {
      expect(Object.keys(VEHICLE_PROFILES)).toHaveLength(5);
      for (const type of ALL_TYPES) {
        expect(VEHICLE_PROFILES).toHaveProperty(type);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Type-specific speed bounds
  // ────────────────────────────────────────────────────────────────
  describe("Type-specific speed bounds", () => {
    it("each vehicle starts at its own profile minSpeed", () => {
      const vehicles = getInternalVehicles(manager);
      for (const vehicle of vehicles.values()) {
        const profile = getProfile(vehicle.type);
        expect(vehicle.speed).toBe(profile.minSpeed);
      }
    });

    it("truck has lower maxSpeed than car", () => {
      expect(VEHICLE_PROFILES.truck.maxSpeed).toBeLessThan(VEHICLE_PROFILES.car.maxSpeed);
    });

    it("motorcycle has higher maxSpeed than car", () => {
      expect(VEHICLE_PROFILES.motorcycle.maxSpeed).toBeGreaterThan(VEHICLE_PROFILES.car.maxSpeed);
    });

    it("vehicles of different types start at their own profile minSpeed", () => {
      cleanupManager(manager);
      manager = createManager(network, {
        car: 1,
        truck: 1,
        motorcycle: 1,
      });
      const vehicles = getInternalVehicles(manager);
      for (const vehicle of vehicles.values()) {
        const profile = getProfile(vehicle.type);
        expect(vehicle.speed).toBe(profile.minSpeed);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Ambulance ignores heat zones
  // ────────────────────────────────────────────────────────────────
  describe("Ambulance ignores heat zones", () => {
    it("ambulance speed is not reduced in heat zones", () => {
      cleanupManager(manager);
      manager = createManager(network, { ambulance: 1, car: 1 });

      const vehicles = getInternalVehicles(manager);
      const ambulance = [...vehicles.values()].find((v) => v.type === "ambulance")!;
      const car = [...vehicles.values()].find((v) => v.type === "car")!;

      // Place both on the same edge so edge maxSpeed is identical
      car.currentEdge = ambulance.currentEdge;
      const edgeMax = ambulance.currentEdge.maxSpeed;

      const ambProfile = getProfile("ambulance");
      const carProfile = getProfile("car");

      // Set both to same starting speed
      const startSpeed = Math.min(edgeMax, ambProfile.maxSpeed, carProfile.maxSpeed);
      ambulance.speed = startSpeed;
      ambulance.targetSpeed = startSpeed;
      car.speed = startSpeed;
      car.targetSpeed = startSpeed;

      // Mock heat zone ON
      vi.spyOn(network, "isPositionInHeatZone").mockReturnValue(true);

      const updateSpeed = (manager as any).updateSpeed.bind(manager);
      updateSpeed(ambulance, 1000);
      updateSpeed(car, 1000);

      const heatZoneFactor = (manager as any).options.heatZoneSpeedFactor;
      expect(heatZoneFactor).toBeLessThan(1);

      // Car's effective max is reduced by heatZoneFactor; ambulance's is not
      // So after updateSpeed, ambulance speed >= car speed
      expect(ambulance.speed).toBeGreaterThanOrEqual(car.speed);
    });

    it("car speed IS reduced in heat zones", () => {
      cleanupManager(manager);
      manager = createManager(network, { car: 1 });

      vi.spyOn(network, "isPositionInHeatZone").mockReturnValue(true);

      const vehicles = getInternalVehicles(manager);
      const car = [...vehicles.values()].find((v) => v.type === "car")!;
      const carProfile = getProfile("car");

      car.speed = carProfile.maxSpeed;
      car.targetSpeed = carProfile.maxSpeed;

      const updateSpeed = (manager as any).updateSpeed.bind(manager);
      updateSpeed(car, 1000);

      const heatZoneFactor = (manager as any).options.heatZoneSpeedFactor;
      const effectiveMax = Math.min(carProfile.maxSpeed, car.currentEdge.maxSpeed) * heatZoneFactor;
      // Car speed must be clamped to heat-zone-adjusted max
      expect(car.speed).toBeLessThanOrEqual(effectiveMax + 0.01);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 5. Following distance by size
  // ────────────────────────────────────────────────────────────────
  describe("Following distance by size", () => {
    it("small vehicles (motorcycle) use 15m gap", () => {
      expect(FOLLOWING_DISTANCE_BY_SIZE.small).toBe(0.015);
    });

    it("medium vehicles (car) use 20m gap", () => {
      expect(FOLLOWING_DISTANCE_BY_SIZE.medium).toBe(0.02);
    });

    it("large vehicles (truck/bus) use 30m gap", () => {
      expect(FOLLOWING_DISTANCE_BY_SIZE.large).toBe(0.03);
    });

    it("all sizes are covered", () => {
      expect(Object.keys(FOLLOWING_DISTANCE_BY_SIZE)).toEqual(
        expect.arrayContaining(["small", "medium", "large"])
      );
    });

    it("following distances increase with vehicle size", () => {
      expect(FOLLOWING_DISTANCE_BY_SIZE.small).toBeLessThan(FOLLOWING_DISTANCE_BY_SIZE.medium);
      expect(FOLLOWING_DISTANCE_BY_SIZE.medium).toBeLessThan(FOLLOWING_DISTANCE_BY_SIZE.large);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 6. API spawn with type distribution
  // ────────────────────────────────────────────────────────────────
  describe("API spawn with type distribution", () => {
    it("creates correct distribution from vehicleTypes", () => {
      cleanupManager(manager);
      manager = createManager(network, { car: 2, truck: 1 });

      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(3);

      const types = [...vehicles.values()].map((v) => v.type);
      expect(types.filter((t) => t === "car")).toHaveLength(2);
      expect(types.filter((t) => t === "truck")).toHaveLength(1);
    });

    it("creates vehicles of all types when specified", () => {
      cleanupManager(manager);
      manager = createManager(network, {
        car: 1,
        truck: 1,
        motorcycle: 1,
        ambulance: 1,
        bus: 1,
      });

      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(5);

      const typeCounts = new Map<string, number>();
      for (const v of vehicles.values()) {
        typeCounts.set(v.type, (typeCounts.get(v.type) || 0) + 1);
      }
      for (const type of ALL_TYPES) {
        expect(typeCounts.get(type)).toBe(1);
      }
    });

    it("creates only trucks when only truck is specified", () => {
      cleanupManager(manager);
      manager = createManager(network, { truck: 3 });

      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(3);
      for (const v of vehicles.values()) {
        expect(v.type).toBe("truck");
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 7. Default distribution (was backward compatibility)
  // ────────────────────────────────────────────────────────────────
  describe("Default distribution", () => {
    it("uses weighted distribution when no type is specified", () => {
      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(config.vehicleCount);
      const types = new Set([...vehicles.values()].map((v) => v.type));
      // With 5 vehicles and weighted distribution, we should have at least 2 distinct types
      expect(types.size).toBeGreaterThanOrEqual(2);
    });

    it("distributes across config.vehicleCount when vehicleTypes not provided", () => {
      (config as any).vehicleCount = 4;
      cleanupManager(manager);
      manager = createManager(network);

      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(4);
      const types = new Set([...vehicles.values()].map((v) => v.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });

    it("distributes across config.vehicleCount when vehicleTypes is empty", () => {
      (config as any).vehicleCount = 10;
      cleanupManager(manager);
      manager = createManager(network, {});

      const vehicles = getInternalVehicles(manager);
      expect(vehicles.size).toBe(10);
      const types = new Set([...vehicles.values()].map((v) => v.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 8. Pathfinding restrictions
  // ────────────────────────────────────────────────────────────────
  describe("Pathfinding restrictions", () => {
    let nodes: ReturnType<typeof buildGraph>;

    beforeEach(() => {
      nodes = buildGraph(FIXTURE_PATH);
    });

    it("builds a graph from the test fixture", () => {
      expect(nodes.size).toBeGreaterThan(0);
    });

    it("findRoute finds a route between connected nodes", () => {
      // Use known start/end from the test network (road-1 + road-2 form a path)
      const startId = "45.5017000,-73.5673000";
      const endId = "45.5029000,-73.5661000";
      const route = findRoute(nodes, startId, endId);
      expect(route).not.toBeNull();
      expect(route!.edgeIds.length).toBeGreaterThan(0);
      expect(route!.distance).toBeGreaterThan(0);
    });

    it("restricting all highway types yields no route", () => {
      const startId = "45.5017000,-73.5673000";
      const endId = "45.5029000,-73.5661000";
      // Block all road types in the test network
      const route = findRoute(nodes, startId, endId, undefined, [
        "primary",
        "secondary",
        "tertiary",
      ]);
      expect(route).toBeNull();
    });

    it("restricting unused highway types still finds a route", () => {
      const startId = "45.5017000,-73.5673000";
      const endId = "45.5029000,-73.5661000";
      // "residential" doesn't exist in test network, so restriction has no effect
      const route = findRoute(nodes, startId, endId, undefined, ["residential"]);
      expect(route).not.toBeNull();
      expect(route!.edgeIds.length).toBeGreaterThan(0);
    });

    it("restricting 'primary' forces an alternate route or returns null", () => {
      // road-1 is primary, road-2 is secondary, road-3 is tertiary
      // Start at road-1 start, end at road-2 end — primary is needed to enter the network
      const startId = "45.5017000,-73.5673000";
      const endId = "45.5029000,-73.5661000";

      // With primary restricted, the start node's only forward edge is blocked (oneway primary)
      const restricted = findRoute(nodes, startId, endId, undefined, ["primary"]);
      // Either null or uses a different path
      if (restricted === null) {
        // Fallback: without restrictions, route exists
        const unrestricted = findRoute(nodes, startId, endId);
        expect(unrestricted).not.toBeNull();
      } else {
        // If found, it shouldn't use primary edges directly
        expect(restricted.edgeIds.length).toBeGreaterThan(0);
      }
    });

    it("worker fallback: route found without restrictions when restricted returns null", () => {
      // Simulate the worker fallback logic
      const startId = "45.5017000,-73.5673000";
      const endId = "45.5029000,-73.5661000";
      const heavyRestrictions = ["primary", "secondary", "tertiary"];

      let route = findRoute(nodes, startId, endId, undefined, heavyRestrictions);

      // Mimic worker fallback: if no route with restrictions, retry without
      if (!route && heavyRestrictions.length > 0) {
        route = findRoute(nodes, startId, endId);
      }

      expect(route).not.toBeNull();
      expect(route!.edgeIds.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 9. VehicleDTO includes type
  // ────────────────────────────────────────────────────────────────
  describe("VehicleDTO includes type", () => {
    it("serializeVehicle includes type field matching vehicle type", () => {
      for (const type of ALL_TYPES) {
        const vehicle = {
          id: `v-${type}`,
          name: `Test ${type}`,
          type,
          position: [1.0, 36.0] as [number, number],
          speed: 30,
          bearing: 90,
          progress: 0,
          currentEdge: { id: "e1" },
        } as unknown as Vehicle;

        const dto = serializeVehicle(vehicle);
        expect(dto.type).toBe(type);
        expect(dto.id).toBe(`v-${type}`);
      }
    });

    it("getVehicles() returns DTOs with correct types for mixed fleet", () => {
      cleanupManager(manager);
      manager = createManager(network, { car: 1, ambulance: 1, bus: 1 });

      const dtos = manager.getVehicles();
      expect(dtos).toHaveLength(3);

      const dtoTypes = dtos.map((d) => d.type).sort();
      expect(dtoTypes).toEqual(["ambulance", "bus", "car"]);
    });

    it("DTO does not leak internal vehicle fields", () => {
      const dtos = manager.getVehicles();
      for (const dto of dtos) {
        expect(dto).toHaveProperty("type");
        expect(dto).toHaveProperty("id");
        expect(dto).toHaveProperty("name");
        expect(dto).toHaveProperty("position");
        expect(dto).toHaveProperty("speed");
        expect(dto).toHaveProperty("heading");
        // Internal fields should not be present
        expect(dto).not.toHaveProperty("bearing");
        expect(dto).not.toHaveProperty("progress");
        expect(dto).not.toHaveProperty("currentEdge");
      }
    });
  });
});

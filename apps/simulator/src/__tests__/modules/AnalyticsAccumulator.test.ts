import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsAccumulator } from "../../modules/AnalyticsAccumulator";
import type { Vehicle } from "../../types";

function createMockRegistry() {
  const vehicles = new Map<string, Vehicle>();
  return {
    get: vi.fn((id: string) => vehicles.get(id)),
    getAll: vi.fn(() => vehicles),
    _set: (id: string, v: Vehicle) => vehicles.set(id, v),
  };
}

function createMockFleetManager() {
  const fleets: { id: string; vehicleIds: string[] }[] = [];
  return {
    getFleets: vi.fn(() => fleets),
    _addFleet: (id: string, vehicleIds: string[]) => fleets.push({ id, vehicleIds }),
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: "v1",
    name: "Car 1",
    position: [-1.3, 36.8] as [number, number],
    speed: 40,
    heading: 90,
    status: "moving",
    routeIndex: 0,
    route: [],
    ...overrides,
  } as Vehicle;
}

describe("AnalyticsAccumulator", () => {
  let accumulator: AnalyticsAccumulator;
  let registry: ReturnType<typeof createMockRegistry>;
  let fleetManager: ReturnType<typeof createMockFleetManager>;

  beforeEach(() => {
    registry = createMockRegistry();
    fleetManager = createMockFleetManager();
    accumulator = new AnalyticsAccumulator(registry as any, fleetManager as any);
  });

  describe("updateVehicleStats", () => {
    it("should accumulate active time and distance for moving vehicles", () => {
      const vehicle = makeVehicle({ id: "v1", speed: 60 });
      // 60 km/h for 1000ms = 60/3600 * 1 = 0.01667 km
      accumulator.updateVehicleStats(vehicle, 1000);

      const stats = accumulator.getStats("v1");
      expect(stats).toBeDefined();
      expect(stats!.activeTime).toBeCloseTo(1, 1);
      expect(stats!.distanceTraveled).toBeGreaterThan(0);
      expect(stats!.avgSpeed).toBe(60);
      expect(stats!.idleTime).toBe(0);
    });

    it("should accumulate idle time for stationary vehicles", () => {
      const vehicle = makeVehicle({ id: "v1", speed: 0 });
      accumulator.updateVehicleStats(vehicle, 2000);

      const stats = accumulator.getStats("v1");
      expect(stats!.idleTime).toBeCloseTo(2, 1);
      expect(stats!.activeTime).toBe(0);
      expect(stats!.distanceTraveled).toBe(0);
    });

    it("should compute rolling average speed", () => {
      const vehicle = makeVehicle({ id: "v1", speed: 40 });
      accumulator.updateVehicleStats(vehicle, 1000);

      vehicle.speed = 80;
      accumulator.updateVehicleStats(vehicle, 1000);

      const stats = accumulator.getStats("v1");
      // (40 + 80) / 2 = 60
      expect(stats!.avgSpeed).toBe(60);
    });
  });

  describe("onWaypointReached", () => {
    it("should increment waypoint counter", () => {
      accumulator.onWaypointReached("v1");
      accumulator.onWaypointReached("v1");

      const stats = accumulator.getStats("v1");
      expect(stats!.waypointsReached).toBe(2);
    });
  });

  describe("onDirectionSet", () => {
    it("should set optimal distance and reset actual distance", () => {
      const vehicle = makeVehicle({ id: "v1", speed: 60 });
      accumulator.updateVehicleStats(vehicle, 1000);

      accumulator.onDirectionSet("v1", 5.0);

      const stats = accumulator.getStats("v1");
      expect(stats!.optimalDistance).toBe(5.0);
      expect(stats!.actualDistance).toBe(0);
    });
  });

  describe("getFleetStats", () => {
    it("should aggregate stats for fleet vehicles", () => {
      fleetManager._addFleet("fleet-1", ["v1", "v2"]);

      const v1 = makeVehicle({ id: "v1", speed: 60 });
      const v2 = makeVehicle({ id: "v2", speed: 40 });
      registry._set("v1", v1);
      registry._set("v2", v2);

      accumulator.updateVehicleStats(v1, 1000);
      accumulator.updateVehicleStats(v2, 1000);

      const fleetStats = accumulator.getFleetStats("fleet-1");
      expect(fleetStats.fleetId).toBe("fleet-1");
      expect(fleetStats.vehicleCount).toBe(2);
      expect(fleetStats.activeCount).toBe(2);
      expect(fleetStats.totalDistance).toBeGreaterThan(0);
      expect(fleetStats.avgSpeed).toBe(50); // (60+40)/2
    });

    it("should handle fleet with no tracked vehicles", () => {
      fleetManager._addFleet("fleet-empty", ["v99"]);
      const fleetStats = accumulator.getFleetStats("fleet-empty");
      expect(fleetStats.vehicleCount).toBe(1);
      expect(fleetStats.totalDistance).toBe(0);
      expect(fleetStats.avgSpeed).toBe(0);
    });

    it("should compute route efficiency when optimal and actual distances are set", () => {
      fleetManager._addFleet("fleet-1", ["v1"]);
      const v1 = makeVehicle({ id: "v1", speed: 60 });
      registry._set("v1", v1);

      accumulator.onDirectionSet("v1", 10);
      accumulator.updateVehicleStats(v1, 1000);

      const stats = accumulator.getStats("v1")!;
      // Manually set actualDistance to test efficiency
      stats.actualDistance = 12;

      const fleetStats = accumulator.getFleetStats("fleet-1");
      // efficiency = optimal / actual = 10 / 12 ≈ 0.833
      expect(fleetStats.routeEfficiency).toBeCloseTo(0.833, 2);
    });
  });

  describe("getSummary", () => {
    it("should return global analytics summary", () => {
      const v1 = makeVehicle({ id: "v1", speed: 60 });
      const v2 = makeVehicle({ id: "v2", speed: 0 });
      registry._set("v1", v1);
      registry._set("v2", v2);

      accumulator.updateVehicleStats(v1, 1000);
      accumulator.updateVehicleStats(v2, 1000);

      const summary = accumulator.getSummary();
      expect(summary.totalVehicles).toBe(2);
      expect(summary.activeVehicles).toBe(1); // only v1 is moving
      expect(summary.totalDistanceTraveled).toBeGreaterThan(0);
      expect(summary.avgSpeed).toBe(60);
      expect(summary.totalIdleTime).toBeGreaterThan(0);
      expect(summary.timestamp).toBeGreaterThan(0);
    });

    it("should return defaults when no stats exist", () => {
      const summary = accumulator.getSummary();
      expect(summary.totalVehicles).toBe(0);
      expect(summary.activeVehicles).toBe(0);
      expect(summary.avgRouteEfficiency).toBe(1);
    });
  });

  describe("getSnapshot", () => {
    it("should return summary and per-fleet breakdowns", () => {
      fleetManager._addFleet("fleet-1", ["v1"]);
      const v1 = makeVehicle({ id: "v1", speed: 60 });
      registry._set("v1", v1);
      accumulator.updateVehicleStats(v1, 1000);

      const snapshot = accumulator.getSnapshot();
      expect(snapshot.summary).toBeDefined();
      expect(snapshot.fleets).toHaveLength(1);
      expect(snapshot.fleets[0].fleetId).toBe("fleet-1");
    });
  });

  describe("resetStats", () => {
    it("should clear all accumulated data", () => {
      const v1 = makeVehicle({ id: "v1", speed: 60 });
      accumulator.updateVehicleStats(v1, 1000);
      expect(accumulator.getStats("v1")).toBeDefined();

      accumulator.resetStats();
      expect(accumulator.getStats("v1")).toBeUndefined();
      expect(accumulator.getAllStats().size).toBe(0);
    });
  });
});

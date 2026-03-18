import { describe, it, expect } from "vitest";
import type {
  Position,
  VehicleType,
  VehicleDTO,
  ExportVehicle,
  VehicleUpdate,
  Fleet,
  TimeOfDay,
  ClockState,
  SimulationStatus,
  StartOptions,
  HighwayType,
  Node,
  Edge,
  Route,
  Waypoint,
  DirectionResult,
  POI,
  IncidentType,
  IncidentDTO,
  RecordingMetadata,
  ReplayStatus,
} from "../index";

// Helper to assert a value satisfies a type at compile time
function assertType<T>(_value: T): void {
  // compile-time check only
}

describe("@moveet/shared-types", () => {
  describe("VehicleType", () => {
    it("accepts valid vehicle types", () => {
      const types: VehicleType[] = [
        "car",
        "truck",
        "motorcycle",
        "ambulance",
        "bus",
      ];
      expect(types).toHaveLength(5);
    });
  });

  describe("VehicleDTO", () => {
    it("has all required fields", () => {
      const dto: VehicleDTO = {
        id: "v1",
        name: "Vehicle 1",
        type: "car",
        position: [-1.3, 36.8],
        speed: 45,
        heading: 90,
      };
      expect(dto.id).toBe("v1");
      expect(dto.position).toEqual([-1.3, 36.8]);
    });

    it("accepts optional fleetId", () => {
      const dto: VehicleDTO = {
        id: "v1",
        name: "Vehicle 1",
        type: "truck",
        position: [-1.3, 36.8],
        speed: 30,
        heading: 180,
        fleetId: "fleet-1",
      };
      expect(dto.fleetId).toBe("fleet-1");
    });
  });

  describe("ExportVehicle", () => {
    it("has required fields", () => {
      const v: ExportVehicle = {
        id: "v1",
        name: "Vehicle 1",
        position: [-1.3, 36.8],
      };
      expect(v.id).toBe("v1");
    });

    it("accepts optional type", () => {
      const v: ExportVehicle = {
        id: "v1",
        name: "Vehicle 1",
        position: [-1.3, 36.8],
        type: "ambulance",
      };
      expect(v.type).toBe("ambulance");
    });
  });

  describe("VehicleUpdate", () => {
    it("has required fields", () => {
      const update: VehicleUpdate = {
        latitude: -1.3,
        longitude: 36.8,
        id: "v1",
      };
      expect(update.id).toBe("v1");
    });
  });

  describe("Fleet", () => {
    it("has all required fields", () => {
      const fleet: Fleet = {
        id: "f1",
        name: "Fleet 1",
        color: "#ff0000",
        source: "local",
        vehicleIds: ["v1", "v2"],
      };
      expect(fleet.source).toBe("local");
      expect(fleet.vehicleIds).toHaveLength(2);
    });

    it("accepts external source", () => {
      const fleet: Fleet = {
        id: "f2",
        name: "Fleet 2",
        color: "#00ff00",
        source: "external",
        vehicleIds: [],
      };
      expect(fleet.source).toBe("external");
    });
  });

  describe("ClockState", () => {
    it("has all required fields", () => {
      const clock: ClockState = {
        currentTime: "2024-01-01T08:00:00Z",
        speedMultiplier: 1.0,
        hour: 8,
        timeOfDay: "morning_rush",
      };
      expect(clock.hour).toBe(8);
      expect(clock.timeOfDay).toBe("morning_rush");
    });
  });

  describe("TimeOfDay", () => {
    it("accepts all valid values", () => {
      const periods: TimeOfDay[] = [
        "morning_rush",
        "midday",
        "evening_rush",
        "night",
      ];
      expect(periods).toHaveLength(4);
    });
  });

  describe("SimulationStatus", () => {
    it("has required fields", () => {
      const status: SimulationStatus = {
        interval: 100,
        running: true,
        ready: true,
      };
      expect(status.running).toBe(true);
    });

    it("accepts optional clock", () => {
      const status: SimulationStatus = {
        interval: 100,
        running: true,
        ready: true,
        clock: {
          currentTime: "2024-01-01T12:00:00Z",
          speedMultiplier: 2,
          hour: 12,
          timeOfDay: "midday",
        },
      };
      expect(status.clock?.hour).toBe(12);
    });
  });

  describe("StartOptions", () => {
    it("has all required fields", () => {
      const opts: StartOptions = {
        minSpeed: 10,
        maxSpeed: 60,
        speedVariation: 0.2,
        acceleration: 2,
        deceleration: 3,
        turnThreshold: 45,
        heatZoneSpeedFactor: 0.5,
        updateInterval: 100,
      };
      expect(opts.minSpeed).toBe(10);
      expect(opts.updateInterval).toBe(100);
    });
  });

  describe("HighwayType", () => {
    it("accepts all valid values", () => {
      const types: HighwayType[] = [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "residential",
      ];
      expect(types).toHaveLength(6);
    });
  });

  describe("Edge and Node", () => {
    it("can create a valid graph structure", () => {
      const nodeA: Node = {
        id: "n1",
        coordinates: [-1.3, 36.8],
        connections: [],
      };
      const nodeB: Node = {
        id: "n2",
        coordinates: [-1.31, 36.81],
        connections: [],
      };
      const edge: Edge = {
        id: "e1",
        streetId: "s1",
        start: nodeA,
        end: nodeB,
        distance: 1.2,
        bearing: 45,
        highway: "primary",
        maxSpeed: 50,
        surface: "asphalt",
        oneway: false,
      };
      nodeA.connections.push(edge);
      expect(edge.distance).toBe(1.2);
      expect(nodeA.connections).toHaveLength(1);
    });
  });

  describe("Route", () => {
    it("has edges and distance", () => {
      const route: Route = { edges: [], distance: 0 };
      expect(route.distance).toBe(0);
    });
  });

  describe("Waypoint", () => {
    it("has required position", () => {
      const wp: Waypoint = { position: [-1.3, 36.8] };
      expect(wp.position).toEqual([-1.3, 36.8]);
    });

    it("accepts optional fields", () => {
      const wp: Waypoint = {
        position: [-1.3, 36.8],
        dwellTime: 30,
        label: "Stop A",
      };
      expect(wp.dwellTime).toBe(30);
      expect(wp.label).toBe("Stop A");
    });
  });

  describe("DirectionResult", () => {
    it("creates ok result", () => {
      const result: DirectionResult = {
        vehicleId: "v1",
        status: "ok",
        eta: 120,
        route: { start: [-1.3, 36.8], end: [-1.31, 36.81], distance: 1.5 },
      };
      expect(result.status).toBe("ok");
    });

    it("creates error result", () => {
      const result: DirectionResult = {
        vehicleId: "v1",
        status: "error",
        error: "No route found",
      };
      expect(result.status).toBe("error");
    });
  });

  describe("POI", () => {
    it("has all required fields", () => {
      const poi: POI = {
        id: "p1",
        name: "Hospital",
        coordinates: [-1.3, 36.8],
        type: "hospital",
      };
      expect(poi.name).toBe("Hospital");
    });

    it("accepts null name", () => {
      const poi: POI = {
        id: "p2",
        name: null,
        coordinates: [-1.3, 36.8],
        type: "unknown",
      };
      expect(poi.name).toBeNull();
    });
  });

  describe("IncidentType and IncidentDTO", () => {
    it("accepts all incident types", () => {
      const types: IncidentType[] = ["accident", "closure", "construction"];
      expect(types).toHaveLength(3);
    });

    it("creates valid IncidentDTO", () => {
      const incident: IncidentDTO = {
        id: "i1",
        edgeIds: ["e1", "e2"],
        type: "accident",
        severity: 0.8,
        speedFactor: 0.2,
        startTime: Date.now(),
        duration: 60000,
        expiresAt: Date.now() + 60000,
        autoClears: true,
        position: [-1.3, 36.8],
      };
      expect(incident.type).toBe("accident");
    });
  });

  describe("RecordingMetadata", () => {
    it("has all required fields", () => {
      const meta: RecordingMetadata = {
        filePath: "/recordings/test.json",
        startTime: "2024-01-01T00:00:00Z",
        duration: 60000,
        eventCount: 100,
        fileSize: 1024,
        vehicleCount: 5,
      };
      expect(meta.vehicleCount).toBe(5);
    });
  });

  describe("ReplayStatus", () => {
    it("creates live status", () => {
      const status: ReplayStatus = { mode: "live" };
      expect(status.mode).toBe("live");
    });

    it("creates replay status with all fields", () => {
      const status: ReplayStatus = {
        mode: "replay",
        file: "test.json",
        progress: 0.5,
        duration: 60000,
        currentTime: 30000,
        speed: 2,
        paused: false,
      };
      expect(status.mode).toBe("replay");
      expect(status.progress).toBe(0.5);
    });
  });

  describe("Position type alias", () => {
    it("is a tuple of two numbers", () => {
      const pos: Position = [-1.2921, 36.8219];
      assertType<[number, number]>(pos);
      expect(pos).toHaveLength(2);
    });
  });
});

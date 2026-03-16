import type {
  Vehicle,
  VehicleDTO,
  Road,
  POI,
  Position,
  SimulationStatus,
  Modifiers,
  Heatzone,
  RoadNetwork,
  StartOptions,
} from "@/types";

export function createVehicleDTO(overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id: "vehicle-1",
    name: "Test Vehicle",
    type: "car",
    position: [-1.2921, 36.8219] as Position,
    speed: 50,
    heading: 90,
    ...overrides,
  };
}

export function createVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    ...createVehicleDTO(),
    position: [36.8219, -1.2921] as Position, // inverted for display
    visible: true,
    selected: false,
    hovered: false,
    ...overrides,
  };
}

export function createRoad(overrides: Partial<Road> = {}): Road {
  return {
    name: "Test Road",
    nodeIds: new Set<string>(),
    streets: [
      [
        [36.82, -1.29],
        [36.83, -1.3],
      ],
    ],
    ...overrides,
  };
}

export function createPOI(overrides: Partial<POI> = {}): POI {
  return {
    id: "poi-1",
    name: "Test POI",
    type: "shop",
    coordinates: [-1.29, 36.82] as Position,
    ...overrides,
  };
}

export function createStatus(overrides: Partial<SimulationStatus> = {}): SimulationStatus {
  return {
    running: false,
    interval: 1000,
    ready: true,
    ...overrides,
  };
}

export function createModifiers(overrides: Partial<Modifiers> = {}): Modifiers {
  return {
    showDirections: true,
    showHeatzones: false,
    showHeatmap: false,
    showVehicles: true,
    showPOIs: false,
    ...overrides,
  };
}

export function createStartOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    minSpeed: 10,
    maxSpeed: 50,
    speedVariation: 0.1,
    acceleration: 5,
    deceleration: 7,
    turnThreshold: 30,
    updateInterval: 10000,
    heatZoneSpeedFactor: 0.5,
    ...overrides,
  };
}

export function createHeatzone(overrides: Partial<Heatzone> = {}): Heatzone {
  return {
    type: "Feature",
    properties: {
      id: "hz-1",
      intensity: 0.5,
      timestamp: "2026-01-01T00:00:00Z",
      radius: 500,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [36.82, -1.29],
        [36.83, -1.3],
        [36.84, -1.29],
      ],
    },
    ...overrides,
  };
}

export function createRoadNetwork(overrides: Partial<RoadNetwork> = {}): RoadNetwork {
  return {
    type: "FeatureCollection",
    features: [],
    ...overrides,
  };
}

export interface ApiResponse<T> {
  data: T | undefined;
  error?: string;
}

export type Position = [number, number];

export type LatLng = {
  lat: number;
  lng: number;
};

export interface Modifiers {
  showDirections: boolean;
  showHeatzones: boolean;
  showHeatmap: boolean;
  showVehicles: boolean;
  showPOIs: boolean;
}

export interface Fleet {
  id: string;
  name: string;
  color: string;
  source: 'local' | 'external';
  vehicleIds: string[];
}

export interface VehicleDTO {
  id: string;
  name: string;
  position: Position;
  speed: number;
  heading: number;
  fleetId?: string;
}

interface VehicleUIFlags {
  visible: boolean;
  selected: boolean;
  hovered: boolean;
}

export type Vehicle = VehicleDTO & VehicleUIFlags;

export interface SimulationStatus {
  interval: number;
  running: boolean;
  ready: boolean;
}

export interface StartOptions {
  minSpeed: number;
  maxSpeed: number;
  speedVariation: number;
  acceleration: number;
  deceleration: number;
  turnThreshold: number;
  updateInterval: number;
  heatZoneSpeedFactor: number;
}

interface RoadFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: Position[];
  };
  properties: {
    name?: string;
    type?: string;
    speed_limit?: number;
    highway?: string;
  };
}

export interface RoadNetwork {
  type: "FeatureCollection";
  features: RoadFeature[];
}
export interface Route {
  edges: Edge[];
  distance: number;
}

export interface Node {
  id: string;
  coordinates: Position;
  connections: Edge[];
}

export interface Edge {
  id: string;
  streetId: string;
  start: Node;
  end: Node;
  distance: number;
  bearing: number;
}

export interface VehicleDirection {
  vehicleId: string;
  route: Route;
  eta: number;
}

export interface Road {
  name: string;
  nodeIds: Set<string>;
  streets: Position[][];
}

export interface POI {
  id: string;
  name: string | null;
  coordinates: Position;
  type: string;
}

export interface Heatzone {
  type: "Feature";
  properties: {
    id: string;
    intensity: number;
    timestamp: string;
    radius: number;
  };
  geometry: {
    type: "Polygon";
    coordinates: Position[];
  };
}

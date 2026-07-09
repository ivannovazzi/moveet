import type { ClientDeps } from "./types";
import type {
  ApiResponse,
  StartOptions,
  SimulationStatus,
  VehicleDTO,
  VehicleDirection as Direction,
  Road,
  Position,
  Heatzone,
  RoadNetwork,
  POI,
  DirectionResponse,
} from "@/types";

/** Polygon geometry as carried by `Heatzone.geometry` (a single `[lng,lat]` ring). */
export interface HeatzonePolygon {
  type: "Polygon";
  coordinates: Position[];
}

/** Body for `POST /heatzones` - server assigns id/timestamp/radius. */
export interface HeatzoneCreate {
  geometry: HeatzonePolygon;
  intensity?: number;
}

/** Body for `PATCH /heatzones/:id` - any subset of the mutable fields. */
export interface HeatzoneUpdate {
  geometry?: HeatzonePolygon;
  intensity?: number;
}

/** Body for `POST /heatzones/seed`. */
export interface HeatzoneSeed {
  count?: number;
}

/**
 * Core simulation control (start/stop/reset/direction) plus read-only
 * network/road/POI/options/heatzone queries and heatzone mutations.
 */
export class SimulationSegment {
  constructor(private deps: ClientDeps) {
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.reset = this.reset.bind(this);
    this.direction = this.direction.bind(this);
    this.batchDirection = this.batchDirection.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.getVehicles = this.getVehicles.bind(this);
    this.getNetwork = this.getNetwork.bind(this);
    this.getRoads = this.getRoads.bind(this);
    this.getPois = this.getPois.bind(this);
    this.findRoad = this.findRoad.bind(this);
    this.findNode = this.findNode.bind(this);
    this.getOptions = this.getOptions.bind(this);
    this.updateOptions = this.updateOptions.bind(this);
    this.getDirections = this.getDirections.bind(this);
    this.getHeatzones = this.getHeatzones.bind(this);
    this.createHeatzone = this.createHeatzone.bind(this);
    this.updateHeatzone = this.updateHeatzone.bind(this);
    this.deleteHeatzone = this.deleteHeatzone.bind(this);
    this.clearHeatzones = this.clearHeatzones.bind(this);
    this.seedHeatzones = this.seedHeatzones.bind(this);
    this.search = this.search.bind(this);
  }

  async start(options: StartOptions): Promise<ApiResponse<void>> {
    return this.deps.http.post<StartOptions, void>("/start", options);
  }

  async stop(): Promise<ApiResponse<void>> {
    return this.deps.http.post("/stop");
  }

  async reset(): Promise<ApiResponse<void>> {
    return this.deps.http.post("/reset");
  }

  async direction(ids: string[], position: Position): Promise<ApiResponse<void>> {
    const body = ids.map((id) => ({ id, lat: position[1], lng: position[0] }));
    return this.deps.http.post("/direction", body);
  }

  async batchDirection(
    assignments: {
      id: string;
      lat: number;
      lng: number;
      waypoints?: {
        lat: number;
        lng: number;
        dwellTime?: number;
        label?: string;
      }[];
    }[]
  ): Promise<ApiResponse<DirectionResponse>> {
    return this.deps.http.post("/direction", assignments);
  }

  async getStatus(): Promise<ApiResponse<SimulationStatus>> {
    return this.deps.http.get<SimulationStatus>("/status");
  }

  async getVehicles(): Promise<ApiResponse<VehicleDTO[]>> {
    return this.deps.http.get<VehicleDTO[]>("/vehicles");
  }

  async getNetwork(): Promise<ApiResponse<RoadNetwork>> {
    return this.deps.http.get<RoadNetwork>("/network");
  }

  async getRoads(): Promise<ApiResponse<Road[]>> {
    return this.deps.http.get<Road[]>("/roads");
  }

  async getPois(): Promise<ApiResponse<POI[]>> {
    return this.deps.http.get<POI[]>("/pois");
  }

  async findRoad(position: Position): Promise<ApiResponse<Road>> {
    return this.deps.http.post<Position, Road>("/find-road", position);
  }

  async findNode(position: Position): Promise<ApiResponse<Position>> {
    return this.deps.http.post<Position, Position>("/find-node", position);
  }

  async getOptions(): Promise<ApiResponse<StartOptions>> {
    return this.deps.http.get<StartOptions>("/options");
  }

  async updateOptions(options: StartOptions): Promise<ApiResponse<void>> {
    return this.deps.http.post<StartOptions, void>("/options", options);
  }

  async getDirections(): Promise<ApiResponse<Direction[]>> {
    return this.deps.http.get<Direction[]>("/directions");
  }

  async getHeatzones(): Promise<ApiResponse<Heatzone[]>> {
    return this.deps.http.get<Heatzone[]>("/heatzones");
  }

  async createHeatzone(body: HeatzoneCreate): Promise<ApiResponse<Heatzone>> {
    return this.deps.http.post<HeatzoneCreate, Heatzone>("/heatzones", body);
  }

  async updateHeatzone(id: string, body: HeatzoneUpdate): Promise<ApiResponse<Heatzone>> {
    return this.deps.http.patch<HeatzoneUpdate, Heatzone>(`/heatzones/${id}`, body);
  }

  async deleteHeatzone(id: string): Promise<ApiResponse<void>> {
    return this.deps.http.delete(`/heatzones/${id}`);
  }

  /** Clear every heatzone (drawn + seeded). */
  async clearHeatzones(): Promise<ApiResponse<void>> {
    return this.deps.http.delete("/heatzones");
  }

  /** Append `count` randomly generated zones; returns the full updated list. */
  async seedHeatzones(body: HeatzoneSeed = {}): Promise<ApiResponse<Heatzone[]>> {
    return this.deps.http.post<HeatzoneSeed, Heatzone[]>("/heatzones/seed", body);
  }

  async search(query: string): Promise<ApiResponse<unknown>> {
    return this.deps.http.post<{ query: string }>(`/search`, { query });
  }
}

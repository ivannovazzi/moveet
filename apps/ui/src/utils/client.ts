import { HttpClient } from "./httpClient";
import { WebSocketClient } from "./wsClient";
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
  Fleet,
} from "@/types";
import type { ResetPayload } from "./wsTypes";

class SimulationService {
  constructor(
    private http: HttpClient,
    private ws: WebSocketClient
  ) {
    this.stop = this.stop.bind(this);
    this.start = this.start.bind(this);
    this.reset = this.reset.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.getRoads = this.getRoads.bind(this);
    this.getPois = this.getPois.bind(this);
    this.findNode = this.findNode.bind(this);
    this.getOptions = this.getOptions.bind(this);
    this.updateOptions = this.updateOptions.bind(this);
    this.getDirections = this.getDirections.bind(this);
    this.getHeatzones = this.getHeatzones.bind(this);
    this.makeHeatzones = this.makeHeatzones.bind(this);
    this.connectWebSocket = this.connectWebSocket.bind(this);
    this.disconnect = this.disconnect.bind(this);
    // events
    this.onConnect = this.onConnect.bind(this);
    this.onDisconnect = this.onDisconnect.bind(this);
    this.onVehicle = this.onVehicle.bind(this);
    this.onStatus = this.onStatus.bind(this);
    this.onOptions = this.onOptions.bind(this);
    this.onHeatzones = this.onHeatzones.bind(this);
    this.onDirection = this.onDirection.bind(this);
    this.onReset = this.onReset.bind(this);
    this.direction = this.direction.bind(this);
    this.getFleets = this.getFleets.bind(this);
    this.createFleet = this.createFleet.bind(this);
    this.deleteFleet = this.deleteFleet.bind(this);
    this.assignVehicles = this.assignVehicles.bind(this);
    this.unassignVehicles = this.unassignVehicles.bind(this);
    this.onFleetCreated = this.onFleetCreated.bind(this);
    this.onFleetDeleted = this.onFleetDeleted.bind(this);
    this.onFleetAssigned = this.onFleetAssigned.bind(this);
  }

  connectWebSocket(): void {
    this.ws.connect();
  }

  disconnect(): void {
    this.ws.disconnect();
  }

  onConnect(handler: () => void): void {
    this.ws.on("connect", () => handler());
  }

  onDisconnect(handler: () => void): void {
    this.ws.on("disconnect", () => handler());
  }

  onVehicle(handler: (vehicle: VehicleDTO) => void): void {
    this.ws.on("vehicle", handler);
  }

  onStatus(handler: (status: SimulationStatus) => void): void {
    this.ws.on("status", handler);
  }

  onOptions(handler: (opts: StartOptions) => void): void {
    this.ws.on("options", handler);
  }

  onHeatzones(handler: (heatzones: Heatzone[]) => void): void {
    this.ws.on("heatzones", handler);
  }

  onDirection(handler: (direction: Direction) => void): void {
    this.ws.on("direction", handler);
  }

  onReset(handler: (data: ResetPayload) => void): void {
    this.ws.on("reset", handler);
  }

  async start(options: StartOptions): Promise<ApiResponse<void>> {
    return this.http.post<StartOptions, void>("/start", options);
  }

  async stop(): Promise<ApiResponse<void>> {
    return this.http.post("/stop");
  }

  async reset(): Promise<ApiResponse<void>> {
    return this.http.post("/reset");
  }

  async direction(ids: string[], position: Position): Promise<ApiResponse<void>> {
    const body = ids.map((id) => ({ id, lat: position[1], lng: position[0] }));
    return this.http.post("/direction", body);
  }

  async getStatus(): Promise<ApiResponse<SimulationStatus>> {
    return this.http.get<SimulationStatus>("/status");
  }

  async getVehicles(): Promise<ApiResponse<VehicleDTO[]>> {
    return this.http.get<VehicleDTO[]>("/vehicles");
  }

  async getNetwork(): Promise<ApiResponse<RoadNetwork>> {
    return this.http.get<RoadNetwork>("/network");
  }

  async getRoads(): Promise<ApiResponse<Road[]>> {
    return this.http.get<Road[]>("/roads");
  }

  async getPois(): Promise<ApiResponse<POI[]>> {
    return this.http.get<POI[]>("/pois");
  }

  async findRoad(position: Position): Promise<ApiResponse<Road>> {
    return this.http.post<Position, Road>("/find-road", position);
  }

  async findNode(position: Position): Promise<ApiResponse<Position>> {
    return this.http.post<Position, Position>("/find-node", position);
  }

  async getOptions(): Promise<ApiResponse<StartOptions>> {
    return this.http.get<StartOptions>("/options");
  }

  async updateOptions(options: StartOptions): Promise<ApiResponse<void>> {
    return this.http.post<StartOptions, void>("/options", options);
  }

  async getDirections(): Promise<ApiResponse<Direction[]>> {
    return this.http.get<Direction[]>("/directions");
  }

  async getHeatzones(): Promise<ApiResponse<Heatzone[]>> {
    return this.http.get<Heatzone[]>("/heatzones");
  }

  async makeHeatzones(): Promise<ApiResponse<void>> {
    return this.http.post("/heatzones");
  }

  async search(query: string): Promise<ApiResponse<unknown>> {
    return this.http.post<{ query: string }>(`/search`, { query });
  }

  async getFleets(): Promise<ApiResponse<Fleet[]>> {
    return this.http.get<Fleet[]>("/fleets");
  }

  async createFleet(name: string): Promise<ApiResponse<Fleet>> {
    return this.http.post<{ name: string }, Fleet>("/fleets", { name });
  }

  async deleteFleet(id: string): Promise<ApiResponse<void>> {
    return this.http.delete(`/fleets/${id}`);
  }

  async assignVehicles(fleetId: string, vehicleIds: string[]): Promise<ApiResponse<void>> {
    return this.http.post<{ vehicleIds: string[] }>(`/fleets/${fleetId}/assign`, { vehicleIds });
  }

  async unassignVehicles(fleetId: string, vehicleIds: string[]): Promise<ApiResponse<void>> {
    return this.http.post<{ vehicleIds: string[] }>(`/fleets/${fleetId}/unassign`, { vehicleIds });
  }

  onFleetCreated(handler: (fleet: Fleet) => void): void {
    this.ws.on("fleet:created", handler);
  }

  onFleetDeleted(handler: (data: { id: string }) => void): void {
    this.ws.on("fleet:deleted", handler);
  }

  onFleetAssigned(handler: (data: { fleetId: string | null; vehicleIds: string[] }) => void): void {
    this.ws.on("fleet:assigned", handler);
  }
}

const host = import.meta.env.VITE_API_URL || "http://localhost:5010";
const wsHost = import.meta.env.VITE_WS_URL || "ws://localhost:5010";

export default new SimulationService(
  new HttpClient(host),
  new WebSocketClient(wsHost, {
    autoReconnect: !import.meta.env.VITEST,
    logReconnects: !import.meta.env.VITEST,
  })
);

import { HttpClient } from "./httpClient";
import { WebSocketClient } from "./wsClient";
import type { ConnectionStateListener } from "./wsClient";
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
  DirectionResponse,
  IncidentDTO,
  IncidentType,
  RecordingFile,
  RecordingMetadata,
  ReplayStatus,
  ClockState,
  TrafficEdge,
} from "@/types";
import type {
  ResetPayload,
  WaypointReachedPayload,
  RouteCompletedPayload,
  IncidentClearedPayload,
  VehicleReroutedPayload,
} from "./wsTypes";

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
    this.batchDirection = this.batchDirection.bind(this);
    this.getFleets = this.getFleets.bind(this);
    this.createFleet = this.createFleet.bind(this);
    this.deleteFleet = this.deleteFleet.bind(this);
    this.assignVehicles = this.assignVehicles.bind(this);
    this.unassignVehicles = this.unassignVehicles.bind(this);
    this.onFleetCreated = this.onFleetCreated.bind(this);
    this.onFleetDeleted = this.onFleetDeleted.bind(this);
    this.onFleetAssigned = this.onFleetAssigned.bind(this);
    this.onWaypointReached = this.onWaypointReached.bind(this);
    this.onRouteCompleted = this.onRouteCompleted.bind(this);
    // incidents
    this.getIncidents = this.getIncidents.bind(this);
    this.createRandomIncident = this.createRandomIncident.bind(this);
    this.removeIncident = this.removeIncident.bind(this);
    this.onIncidentCreated = this.onIncidentCreated.bind(this);
    this.onIncidentCleared = this.onIncidentCleared.bind(this);
    this.onVehicleRerouted = this.onVehicleRerouted.bind(this);
    // recording / replay
    this.startRecording = this.startRecording.bind(this);
    this.stopRecording = this.stopRecording.bind(this);
    this.getRecordings = this.getRecordings.bind(this);
    this.startReplay = this.startReplay.bind(this);
    this.pauseReplay = this.pauseReplay.bind(this);
    this.resumeReplay = this.resumeReplay.bind(this);
    this.stopReplay = this.stopReplay.bind(this);
    this.seekReplay = this.seekReplay.bind(this);
    this.getReplayStatus = this.getReplayStatus.bind(this);
    this.onReplayStatus = this.onReplayStatus.bind(this);
    this.createIncidentAtPosition = this.createIncidentAtPosition.bind(this);
    // clock
    this.getClock = this.getClock.bind(this);
    this.setClock = this.setClock.bind(this);
    this.onClock = this.onClock.bind(this);
    // traffic
    this.getTraffic = this.getTraffic.bind(this);
    this.onTraffic = this.onTraffic.bind(this);
    // connection state
    this.onConnectionStateChange = this.onConnectionStateChange.bind(this);
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

  onConnectionStateChange(listener: ConnectionStateListener): () => void {
    return this.ws.onConnectionStateChange(listener);
  }

  onVehicle(handler: (vehicle: VehicleDTO) => void): void {
    this.ws.on("vehicle", handler);
    this.ws.on<VehicleDTO[]>("vehicles", (vehicles) => {
      for (const v of vehicles) handler(v);
    });
  }

  offVehicle(): void {
    this.ws.off("vehicle");
    this.ws.off("vehicles");
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

  async batchDirection(
    assignments: {
      id: string;
      lat: number;
      lng: number;
      waypoints?: { lat: number; lng: number; dwellTime?: number; label?: string }[];
    }[]
  ): Promise<ApiResponse<DirectionResponse>> {
    return this.http.post("/direction", assignments);
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

  onWaypointReached(handler: (data: WaypointReachedPayload) => void): void {
    this.ws.on("waypoint:reached", handler);
  }

  onRouteCompleted(handler: (data: RouteCompletedPayload) => void): void {
    this.ws.on("route:completed", handler);
  }

  // ─── Incidents ──────────────────────────────────────────────────

  async getIncidents(): Promise<ApiResponse<IncidentDTO[]>> {
    return this.http.get<IncidentDTO[]>("/incidents");
  }

  async createRandomIncident(): Promise<ApiResponse<IncidentDTO>> {
    return this.http.post<undefined, IncidentDTO>("/incidents/random");
  }

  async removeIncident(id: string): Promise<ApiResponse<void>> {
    return this.http.delete(`/incidents/${id}`);
  }

  onIncidentCreated(handler: (data: IncidentDTO) => void): void {
    this.ws.on("incident:created", handler);
  }

  onIncidentCleared(handler: (data: IncidentClearedPayload) => void): void {
    this.ws.on("incident:cleared", handler);
  }

  onVehicleRerouted(handler: (data: VehicleReroutedPayload) => void): void {
    this.ws.on("vehicle:rerouted", handler);
  }

  async createIncidentAtPosition(
    lat: number,
    lng: number,
    type: IncidentType
  ): Promise<ApiResponse<IncidentDTO>> {
    return this.http.post("/incidents/at-position", { lat, lng, type });
  }

  // ─── Recording & Replay ────────────────────────────────────────

  async startRecording(): Promise<ApiResponse<{ status: string; filePath: string }>> {
    return this.http.post("/recording/start");
  }

  async stopRecording(): Promise<ApiResponse<RecordingMetadata>> {
    return this.http.post("/recording/stop");
  }

  async getRecordings(): Promise<ApiResponse<RecordingFile[]>> {
    return this.http.get<RecordingFile[]>("/recordings");
  }

  async startReplay(file: string, speed?: number): Promise<ApiResponse<{ status: string }>> {
    return this.http.post("/replay/start", { file, speed });
  }

  async pauseReplay(): Promise<ApiResponse<void>> {
    return this.http.post("/replay/pause");
  }

  async resumeReplay(): Promise<ApiResponse<void>> {
    return this.http.post("/replay/resume");
  }

  async stopReplay(): Promise<ApiResponse<void>> {
    return this.http.post("/replay/stop");
  }

  async seekReplay(timestamp: number): Promise<ApiResponse<void>> {
    return this.http.post("/replay/seek", { timestamp });
  }

  async setReplaySpeed(speed: number): Promise<ApiResponse<void>> {
    return this.http.post("/replay/speed", { speed });
  }

  async getReplayStatus(): Promise<ApiResponse<ReplayStatus>> {
    return this.http.get<ReplayStatus>("/replay/status");
  }

  onReplayStatus(handler: (data: ReplayStatus) => void): void {
    this.ws.on("replayStatus", handler);
  }

  // ─── Simulation Clock ──────────────────────────────────────────

  async getClock(): Promise<ApiResponse<ClockState>> {
    return this.http.get<ClockState>("/clock");
  }

  async setClock(params: {
    speedMultiplier?: number;
    setTime?: string;
  }): Promise<ApiResponse<ClockState>> {
    return this.http.post<typeof params, ClockState>("/clock", params);
  }

  onClock(handler: (state: ClockState) => void): void {
    this.ws.on("clock", handler);
  }

  // ─── Traffic Congestion ──────────────────────────────────────────

  async getTraffic(): Promise<ApiResponse<TrafficEdge[]>> {
    return this.http.get<TrafficEdge[]>("/traffic");
  }

  onTraffic(handler: (data: TrafficEdge[]) => void): void {
    this.ws.on("traffic", handler);
  }
}

import { config as appConfig } from "./config";

export default new SimulationService(
  new HttpClient(appConfig.apiUrl),
  new WebSocketClient(appConfig.wsUrl, {
    autoReconnect: !import.meta.env.VITEST,
    logReconnects: !import.meta.env.VITEST,
  })
);

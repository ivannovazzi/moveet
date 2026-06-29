import type { ClientDeps } from "./types";
import type {
  ApiResponse,
  ScenarioFile,
  ScenarioLoadResponse,
  ScenarioStatus,
  ScenarioEventPayload,
} from "@/types";

/** Scenario discovery/load/transport plus the consolidated scenario WS event fan-in. */
export class ScenarioSegment {
  constructor(private deps: ClientDeps) {
    this.getScenarios = this.getScenarios.bind(this);
    this.loadScenarioByName = this.loadScenarioByName.bind(this);
    this.startScenario = this.startScenario.bind(this);
    this.pauseScenario = this.pauseScenario.bind(this);
    this.stopScenario = this.stopScenario.bind(this);
    this.getScenarioStatus = this.getScenarioStatus.bind(this);
    this.onScenarioEvent = this.onScenarioEvent.bind(this);
    this.offScenarioEvent = this.offScenarioEvent.bind(this);
  }

  async getScenarios(): Promise<ApiResponse<ScenarioFile[]>> {
    return this.deps.http.get<ScenarioFile[]>("/scenarios");
  }

  async loadScenarioByName(fileName: string): Promise<ApiResponse<ScenarioLoadResponse>> {
    return this.deps.http.post<undefined, ScenarioLoadResponse>(
      `/scenarios/load/${encodeURIComponent(fileName)}`
    );
  }

  async startScenario(): Promise<ApiResponse<ScenarioStatus>> {
    return this.deps.http.post<undefined, ScenarioStatus>("/scenarios/start");
  }

  async pauseScenario(): Promise<ApiResponse<ScenarioStatus>> {
    return this.deps.http.post<undefined, ScenarioStatus>("/scenarios/pause");
  }

  async stopScenario(): Promise<ApiResponse<ScenarioStatus>> {
    return this.deps.http.post<undefined, ScenarioStatus>("/scenarios/stop");
  }

  async getScenarioStatus(): Promise<ApiResponse<ScenarioStatus>> {
    return this.deps.http.get<ScenarioStatus>("/scenarios/status");
  }

  onScenarioEvent(handler: (data: ScenarioEventPayload) => void): void {
    this.deps.ws.on("scenario:event", handler);
    this.deps.ws.on("scenario:started", handler);
    this.deps.ws.on("scenario:completed", handler);
    this.deps.ws.on("scenario:paused", handler);
    this.deps.ws.on("scenario:resumed", handler);
    this.deps.ws.on("scenario:stopped", handler);
  }

  offScenarioEvent(): void {
    this.deps.ws.off("scenario:event");
    this.deps.ws.off("scenario:started");
    this.deps.ws.off("scenario:completed");
    this.deps.ws.off("scenario:paused");
    this.deps.ws.off("scenario:resumed");
    this.deps.ws.off("scenario:stopped");
  }
}

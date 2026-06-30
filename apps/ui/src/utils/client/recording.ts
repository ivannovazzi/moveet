import type { ClientDeps } from "./types";
import type {
  ApiResponse,
  RecordingFile,
  RecordingMetadata,
  ReplayStatus,
  GenerateRecordingRequest,
  GenerateAcceptedResponse,
  GenerateStatus,
} from "@/types";
import type {
  GenerateProgressPayload,
  GenerateCompletePayload,
  GenerateErrorPayload,
} from "../wsTypes";

/** Recording capture, replay transport controls, and historical generation. */
export class RecordingSegment {
  constructor(private deps: ClientDeps) {
    this.startRecording = this.startRecording.bind(this);
    this.stopRecording = this.stopRecording.bind(this);
    this.getRecordings = this.getRecordings.bind(this);
    this.startReplay = this.startReplay.bind(this);
    this.pauseReplay = this.pauseReplay.bind(this);
    this.resumeReplay = this.resumeReplay.bind(this);
    this.stopReplay = this.stopReplay.bind(this);
    this.seekReplay = this.seekReplay.bind(this);
    this.setReplaySpeed = this.setReplaySpeed.bind(this);
    this.getReplayStatus = this.getReplayStatus.bind(this);
    this.onReplayStatus = this.onReplayStatus.bind(this);
    this.offReplayStatus = this.offReplayStatus.bind(this);
    this.generateRecording = this.generateRecording.bind(this);
    this.getGenerateStatus = this.getGenerateStatus.bind(this);
    this.onGenerateProgress = this.onGenerateProgress.bind(this);
    this.offGenerateProgress = this.offGenerateProgress.bind(this);
    this.onGenerateComplete = this.onGenerateComplete.bind(this);
    this.offGenerateComplete = this.offGenerateComplete.bind(this);
    this.onGenerateError = this.onGenerateError.bind(this);
    this.offGenerateError = this.offGenerateError.bind(this);
  }

  async startRecording(): Promise<ApiResponse<{ status: string; filePath: string }>> {
    return this.deps.http.post("/recording/start");
  }

  async stopRecording(): Promise<ApiResponse<RecordingMetadata>> {
    return this.deps.http.post("/recording/stop");
  }

  async getRecordings(): Promise<ApiResponse<RecordingFile[]>> {
    return this.deps.http.get<RecordingFile[]>("/recordings");
  }

  async startReplay(file: string, speed?: number): Promise<ApiResponse<{ status: string }>> {
    return this.deps.http.post("/replay/start", { file, speed });
  }

  async pauseReplay(): Promise<ApiResponse<void>> {
    return this.deps.http.post("/replay/pause");
  }

  async resumeReplay(): Promise<ApiResponse<void>> {
    return this.deps.http.post("/replay/resume");
  }

  async stopReplay(): Promise<ApiResponse<void>> {
    return this.deps.http.post("/replay/stop");
  }

  async seekReplay(timestamp: number): Promise<ApiResponse<void>> {
    return this.deps.http.post("/replay/seek", { timestamp });
  }

  async setReplaySpeed(speed: number): Promise<ApiResponse<void>> {
    return this.deps.http.post("/replay/speed", { speed });
  }

  async getReplayStatus(): Promise<ApiResponse<ReplayStatus>> {
    return this.deps.http.get<ReplayStatus>("/replay/status");
  }

  onReplayStatus(handler: (data: ReplayStatus) => void): void {
    this.deps.ws.on("replay:status", handler);
  }

  offReplayStatus(handler?: (data: ReplayStatus) => void): void {
    this.deps.ws.off("replay:status", handler);
  }

  async generateRecording(
    body: GenerateRecordingRequest
  ): Promise<ApiResponse<GenerateAcceptedResponse>> {
    return this.deps.http.post<GenerateRecordingRequest, GenerateAcceptedResponse>(
      "/recording/generate",
      body
    );
  }

  async getGenerateStatus(): Promise<ApiResponse<GenerateStatus>> {
    return this.deps.http.get<GenerateStatus>("/recording/generate/status");
  }

  onGenerateProgress(handler: (data: GenerateProgressPayload) => void): void {
    this.deps.ws.on("generate:progress", handler);
  }

  offGenerateProgress(handler?: (data: GenerateProgressPayload) => void): void {
    this.deps.ws.off("generate:progress", handler);
  }

  onGenerateComplete(handler: (data: GenerateCompletePayload) => void): void {
    this.deps.ws.on("generate:complete", handler);
  }

  offGenerateComplete(handler?: (data: GenerateCompletePayload) => void): void {
    this.deps.ws.off("generate:complete", handler);
  }

  onGenerateError(handler: (data: GenerateErrorPayload) => void): void {
    this.deps.ws.on("generate:error", handler);
  }

  offGenerateError(handler?: (data: GenerateErrorPayload) => void): void {
    this.deps.ws.off("generate:error", handler);
  }
}

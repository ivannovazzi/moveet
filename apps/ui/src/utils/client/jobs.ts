import type { ClientDeps } from "./types";
import type { ApiResponse } from "@/types";
import type {
  CreateJobRequest,
  JobAssignmentStrategy,
  JobDeletedPayload,
  JobDTO,
} from "@moveet/shared-types";

/** Job board CRUD + the four `job:*` WS channels. */
export class JobSegment {
  constructor(private deps: ClientDeps) {
    this.getJobs = this.getJobs.bind(this);
    this.createJob = this.createJob.bind(this);
    this.assignJob = this.assignJob.bind(this);
    this.cancelJob = this.cancelJob.bind(this);
    this.deleteJob = this.deleteJob.bind(this);
    this.onJobCreated = this.onJobCreated.bind(this);
    this.offJobCreated = this.offJobCreated.bind(this);
    this.onJobUpdated = this.onJobUpdated.bind(this);
    this.offJobUpdated = this.offJobUpdated.bind(this);
    this.onJobSlaBreach = this.onJobSlaBreach.bind(this);
    this.offJobSlaBreach = this.offJobSlaBreach.bind(this);
    this.onJobDeleted = this.onJobDeleted.bind(this);
    this.offJobDeleted = this.offJobDeleted.bind(this);
  }

  async getJobs(): Promise<ApiResponse<JobDTO[]>> {
    return this.deps.http.get<JobDTO[]>("/jobs");
  }

  async createJob(request: CreateJobRequest): Promise<ApiResponse<JobDTO>> {
    return this.deps.http.post<CreateJobRequest, JobDTO>("/jobs", request);
  }

  async assignJob(
    id: string,
    body: { vehicleId?: string; strategy?: JobAssignmentStrategy }
  ): Promise<ApiResponse<JobDTO>> {
    return this.deps.http.post(`/jobs/${id}/assign`, body);
  }

  async cancelJob(id: string): Promise<ApiResponse<JobDTO>> {
    return this.deps.http.post(`/jobs/${id}/cancel`);
  }

  async deleteJob(id: string): Promise<ApiResponse<void>> {
    return this.deps.http.delete(`/jobs/${id}`);
  }

  onJobCreated(handler: (data: JobDTO) => void): void {
    this.deps.ws.on("job:created", handler);
  }

  offJobCreated(handler?: (data: JobDTO) => void): void {
    this.deps.ws.off("job:created", handler);
  }

  onJobUpdated(handler: (data: JobDTO) => void): void {
    this.deps.ws.on("job:updated", handler);
  }

  offJobUpdated(handler?: (data: JobDTO) => void): void {
    this.deps.ws.off("job:updated", handler);
  }

  onJobSlaBreach(handler: (data: JobDTO) => void): void {
    this.deps.ws.on("job:sla-breach", handler);
  }

  offJobSlaBreach(handler?: (data: JobDTO) => void): void {
    this.deps.ws.off("job:sla-breach", handler);
  }

  onJobDeleted(handler: (data: JobDeletedPayload) => void): void {
    this.deps.ws.on("job:deleted", handler);
  }

  offJobDeleted(handler?: (data: JobDeletedPayload) => void): void {
    this.deps.ws.off("job:deleted", handler);
  }
}

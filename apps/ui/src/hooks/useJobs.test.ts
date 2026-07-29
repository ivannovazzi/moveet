import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJobs, isJobLive } from "./useJobs";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import type { JobDTO, JobStatus } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getJobs: vi.fn(),
    createJob: vi.fn(),
    assignJob: vi.fn(),
    cancelJob: vi.fn(),
    deleteJob: vi.fn(),
    onJobCreated: vi.fn(),
    offJobCreated: vi.fn(),
    onJobUpdated: vi.fn(),
    offJobUpdated: vi.fn(),
    onJobSlaBreach: vi.fn(),
    offJobSlaBreach: vi.fn(),
    onJobDeleted: vi.fn(),
    offJobDeleted: vi.fn(),
    onReset: vi.fn(),
    offReset: vi.fn(),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function createJob(overrides: Partial<JobDTO> = {}): JobDTO {
  const createdAt = 1_000_000;
  return {
    id: "job-1",
    reference: "JOB-0001",
    status: "en_route" as JobStatus,
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.3, 36.84] },
    strategy: "nearest",
    vehicleId: "v1",
    vehicleName: "Unit 1",
    createdAt,
    slaSeconds: 900,
    slaDeadline: createdAt + 900_000,
    slaBreached: false,
    ...overrides,
  };
}

/** Captures the handler each `on*` subscription registered. */
function handlers() {
  return {
    created: vi.mocked(client.onJobCreated).mock.calls[0][0],
    updated: vi.mocked(client.onJobUpdated).mock.calls[0][0],
    breach: vi.mocked(client.onJobSlaBreach).mock.calls[0][0],
    deleted: vi.mocked(client.onJobDeleted).mock.calls[0][0],
    reset: vi.mocked(client.onReset).mock.calls[0][0],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getJobs).mockResolvedValue({ data: [] });
  vi.mocked(client.createJob).mockResolvedValue({ data: createJob() });
  vi.mocked(client.assignJob).mockResolvedValue({ data: createJob() });
  vi.mocked(client.cancelJob).mockResolvedValue({ data: createJob() });
  vi.mocked(client.deleteJob).mockResolvedValue({ data: undefined });
});

describe("isJobLive", () => {
  it.each<[JobStatus, boolean]>([
    ["pending", true],
    ["assigned", true],
    ["en_route", true],
    ["on_scene", true],
    ["transporting", true],
    ["complete", false],
    ["cancelled", false],
    ["failed", false],
  ])("treats %s as live=%s", (status, live) => {
    expect(isJobLive(createJob({ status }))).toBe(live);
  });
});

describe("useJobs", () => {
  it("loads the board on mount", async () => {
    const job = createJob();
    vi.mocked(client.getJobs).mockResolvedValue({ data: [job] });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.jobs).toEqual([job]));
  });

  it("surfaces a failed fetch as an error without throwing", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({ data: undefined, error: "boom" });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.jobs).toEqual([]);
  });

  it("appends a job arriving on job:created", async () => {
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(client.onJobCreated).toHaveBeenCalled());

    act(() => handlers().created(createJob({ id: "job-9", status: "pending" })));

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].id).toBe("job-9");
  });

  it("replaces a job in place on job:updated", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({ data: [createJob({ status: "en_route" })] });
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(1));

    act(() => handlers().updated(createJob({ status: "transporting" })));

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].status).toBe("transporting");
  });

  it("upserts an unseen job arriving only on job:updated", async () => {
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(client.onJobUpdated).toHaveBeenCalled());

    act(() => handlers().updated(createJob({ id: "late" })));

    expect(result.current.jobs.map((j) => j.id)).toEqual(["late"]);
  });

  it("toasts and flags the job on an SLA breach", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({ data: [createJob()] });
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(1));

    act(() => handlers().breach(createJob({ slaBreached: true })));

    expect(result.current.jobs[0].slaBreached).toBe(true);
    expect(result.current.counts.breached).toBe(1);
    expect(toast.error).toHaveBeenCalledWith("JOB-0001 breached its SLA");
  });

  it("drops a job on job:deleted", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({ data: [createJob()] });
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(1));

    act(() => handlers().deleted({ id: "job-1" }));

    expect(result.current.jobs).toEqual([]);
  });

  it("refetches the board on a simulation reset", async () => {
    const { result } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(client.getJobs).toHaveBeenCalledTimes(1));

    vi.mocked(client.getJobs).mockResolvedValue({ data: [createJob({ id: "post-reset" })] });
    act(() => handlers().reset({ vehicles: [], directions: [] }));

    await vi.waitFor(() => expect(result.current.jobs.map((j) => j.id)).toEqual(["post-reset"]));
  });

  it("separates live jobs from finished ones in counts", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({
      data: [
        createJob({ id: "a", status: "pending" }),
        createJob({ id: "b", status: "transporting" }),
        createJob({ id: "c", status: "complete" }),
      ],
    });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(3));
    expect(result.current.counts).toEqual({ total: 3, live: 2, queued: 1, breached: 0 });
    expect(result.current.liveJobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("indexes live jobs by the vehicle carrying them", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({
      data: [
        createJob({ id: "a", status: "en_route", vehicleId: "v1" }),
        createJob({ id: "b", status: "transporting", vehicleId: "v2" }),
      ],
    });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(2));
    expect(result.current.jobByVehicleId.get("v1")?.id).toBe("a");
    expect(result.current.jobByVehicleId.get("v2")?.id).toBe("b");
    expect(result.current.jobByVehicleId.has("v3")).toBe(false);
  });

  it("stops claiming a vehicle once its job is finished", async () => {
    // A terminal job keeps its vehicle on the record for the audit trail, but
    // the unit is free — the vehicle list must not still show it as busy.
    vi.mocked(client.getJobs).mockResolvedValue({
      data: [createJob({ id: "a", status: "complete", vehicleId: "v1" })],
    });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.jobByVehicleId.size).toBe(0);
  });

  it("leaves an unassigned pending job out of the index", async () => {
    vi.mocked(client.getJobs).mockResolvedValue({
      data: [createJob({ id: "a", status: "pending", vehicleId: undefined })],
    });

    const { result } = renderHook(() => useJobs());

    await vi.waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.jobByVehicleId.size).toBe(0);
  });

  it("reports an assigned vehicle after a successful create", async () => {
    const { result } = renderHook(() => useJobs());

    const created = await act(async () =>
      result.current.createJob({ pickup: { lat: 1, lng: 2 }, dropoff: { lat: 3, lng: 4 } })
    );

    expect(created).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith("JOB-0001 assigned to Unit 1");
  });

  it("says a job is queued when create returns it unassigned", async () => {
    vi.mocked(client.createJob).mockResolvedValue({
      data: createJob({ status: "pending", vehicleId: undefined, vehicleName: undefined }),
    });
    const { result } = renderHook(() => useJobs());

    await act(async () => {
      await result.current.createJob({ pickup: { lat: 1, lng: 2 }, dropoff: { lat: 3, lng: 4 } });
    });

    expect(toast.info).toHaveBeenCalledWith("JOB-0001 queued — waiting for a free vehicle");
  });

  it("surfaces a create failure and returns null", async () => {
    vi.mocked(client.createJob).mockResolvedValue({ data: undefined, error: "out of bounds" });
    const { result } = renderHook(() => useJobs());

    let created: JobDTO | null = createJob();
    await act(async () => {
      created = await result.current.createJob({
        pickup: { lat: 1, lng: 2 },
        dropoff: { lat: 3, lng: 4 },
      });
    });

    expect(created).toBeNull();
    expect(result.current.error).toBe("out of bounds");
    expect(toast.error).toHaveBeenCalledWith("out of bounds");
  });

  it.each([
    ["cancelJob", () => client.cancelJob],
    ["deleteJob", () => client.deleteJob],
    ["assignJob", () => client.assignJob],
  ])("surfaces a %s failure", async (method, getMock) => {
    vi.mocked(getMock()).mockResolvedValue({ data: undefined, error: "nope" });
    const { result } = renderHook(() => useJobs());

    await act(async () => {
      if (method === "assignJob") await result.current.assignJob("job-1", { vehicleId: "v2" });
      else if (method === "cancelJob") await result.current.cancelJob("job-1");
      else await result.current.deleteJob("job-1");
    });

    expect(result.current.error).toBe("nope");
    expect(toast.error).toHaveBeenCalledWith("nope");
  });

  it("unsubscribes every channel on unmount", async () => {
    const { unmount } = renderHook(() => useJobs());
    await vi.waitFor(() => expect(client.onJobCreated).toHaveBeenCalled());

    unmount();

    expect(client.offJobCreated).toHaveBeenCalled();
    expect(client.offJobUpdated).toHaveBeenCalled();
    expect(client.offJobSlaBreach).toHaveBeenCalled();
    expect(client.offJobDeleted).toHaveBeenCalled();
    expect(client.offReset).toHaveBeenCalled();
  });
});

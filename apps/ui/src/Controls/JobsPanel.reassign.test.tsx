import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JobsPanel, { type JobsPanelProps } from "./JobsPanel";
import type { JobDTO, JobStatus } from "@/types";

function job(overrides: Partial<JobDTO> = {}): JobDTO {
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

const VEHICLES = [
  { id: "v1", name: "Unit 1" },
  { id: "v2", name: "Unit 2" },
  { id: "v3", name: "Unit 3" },
];

function renderPanel(overrides: Partial<JobsPanelProps> = {}) {
  const jobs = overrides.jobs ?? [job()];
  const onAssignJob = vi.fn().mockResolvedValue(undefined);
  const props: JobsPanelProps = {
    jobs,
    counts: { total: jobs.length, live: jobs.length, queued: 0, breached: 0 },
    draft: {
      stage: "idle",
      active: false,
      pickup: null,
      strategy: "nearest",
      slaMinutes: 15,
      submitting: false,
      setStrategy: vi.fn(),
      setSlaMinutes: vi.fn(),
      start: vi.fn(),
      cancel: vi.fn(),
      handleMapClick: vi.fn(),
    },
    onCancelJob: vi.fn().mockResolvedValue(undefined),
    onDeleteJob: vi.fn().mockResolvedValue(undefined),
    onAssignJob,
    vehicles: VEHICLES,
    jobByVehicleId: new Map([["v1", jobs[0]]]),
    error: null,
    ...overrides,
  };
  render(<JobsPanel {...props} />);
  return { onAssignJob, props };
}

describe("JobsPanel reassignment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers reassignment for a job that has not been picked up", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /reassign job JOB-0001/i })).toBeInTheDocument();
  });

  it("does not offer reassignment once the load is on board", () => {
    renderPanel({ jobs: [job({ status: "transporting" })] });

    expect(screen.queryByRole("button", { name: /reassign/i })).not.toBeInTheDocument();
  });

  it("does not offer reassignment for a finished job", () => {
    renderPanel({ jobs: [job({ status: "complete" })] });

    expect(screen.queryByRole("button", { name: /reassign/i })).not.toBeInTheDocument();
  });

  it("re-runs a strategy without naming a vehicle", async () => {
    const user = userEvent.setup();
    const { onAssignJob } = renderPanel();

    await user.click(screen.getByRole("button", { name: /reassign job JOB-0001/i }));
    await user.selectOptions(screen.getByLabelText(/reassign JOB-0001/i), "best_eta");

    expect(onAssignJob).toHaveBeenCalledWith("job-1", { strategy: "best_eta" });
  });

  it("assigns a named vehicle as a manual assignment", async () => {
    const user = userEvent.setup();
    const { onAssignJob } = renderPanel();

    await user.click(screen.getByRole("button", { name: /reassign job JOB-0001/i }));
    await user.selectOptions(screen.getByLabelText(/reassign JOB-0001/i), "v2");

    expect(onAssignJob).toHaveBeenCalledWith("job-1", { vehicleId: "v2" });
  });

  it("leaves out vehicles already carrying a different job", async () => {
    const user = userEvent.setup();
    const other = job({ id: "job-2", reference: "JOB-0002", vehicleId: "v3" });
    renderPanel({
      jobs: [job()],
      jobByVehicleId: new Map([
        ["v1", job()],
        ["v3", other],
      ]),
    });

    await user.click(screen.getByRole("button", { name: /reassign job JOB-0001/i }));
    const select = screen.getByLabelText(/reassign JOB-0001/i);

    // v1 holds THIS job, so it stays selectable; v3 holds another one.
    expect(within(select).getByRole("option", { name: "Unit 1" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Unit 3" })).not.toBeInTheDocument();
  });

  it("collapses the control after a choice", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /reassign job JOB-0001/i }));
    await user.selectOptions(screen.getByLabelText(/reassign JOB-0001/i), "v2");

    expect(screen.queryByLabelText(/reassign JOB-0001/i)).not.toBeInTheDocument();
  });

  it("toggles the control closed again", async () => {
    const user = userEvent.setup();
    renderPanel();

    const toggle = screen.getByRole("button", { name: /reassign job JOB-0001/i });
    await user.click(toggle);
    expect(screen.getByLabelText(/reassign JOB-0001/i)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByLabelText(/reassign JOB-0001/i)).not.toBeInTheDocument();
  });
});

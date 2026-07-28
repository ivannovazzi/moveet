import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JobsPanel, { type JobsPanelProps } from "./JobsPanel";
import type { JobDTO, JobStatus } from "@/types";
import type { JobDraft } from "@/hooks/useJobDraft";

const NOW = 1_700_000_000_000;

function createJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-0001",
    status: "en_route" as JobStatus,
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.31, 36.85] },
    strategy: "nearest",
    vehicleId: "v1",
    vehicleName: "Unit 1",
    createdAt: NOW,
    slaSeconds: 900,
    slaDeadline: NOW + 900_000,
    slaBreached: false,
    ...overrides,
  };
}

function createDraft(overrides: Partial<JobDraft> = {}): JobDraft {
  return {
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
    ...overrides,
  };
}

function renderPanel(overrides: Partial<JobsPanelProps> = {}) {
  const jobs = overrides.jobs ?? [];
  const props: JobsPanelProps = {
    jobs,
    counts: overrides.counts ?? {
      total: jobs.length,
      live: jobs.length,
      queued: 0,
      breached: 0,
    },
    draft: overrides.draft ?? createDraft(),
    onCancelJob: overrides.onCancelJob ?? vi.fn().mockResolvedValue(undefined),
    onDeleteJob: overrides.onDeleteJob ?? vi.fn().mockResolvedValue(undefined),
    error: overrides.error,
  };
  render(<JobsPanel {...props} />);
  return props;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JobsPanel", () => {
  it("shows an empty state before any job exists", () => {
    renderPanel();

    expect(screen.getByText(/No jobs yet/i)).toBeInTheDocument();
  });

  it("renders an error state when the board failed to load", () => {
    renderPanel({ error: "connection lost" });

    expect(screen.getByText("connection lost")).toBeInTheDocument();
  });

  it("lists a job by reference with an operator-facing status", () => {
    renderPanel({ jobs: [createJob({ status: "transporting" })] });

    expect(screen.getByText("JOB-0001")).toBeInTheDocument();
    expect(screen.getByText("Carrying")).toBeInTheDocument();
  });

  it.each<[JobStatus, string]>([
    ["pending", "Queued"],
    ["assigned", "Assigned"],
    ["en_route", "To pickup"],
    ["on_scene", "On scene"],
    ["transporting", "Carrying"],
    ["complete", "Complete"],
    ["cancelled", "Cancelled"],
    ["failed", "Failed"],
  ])("labels the %s status as %s", (status, label) => {
    renderPanel({ jobs: [createJob({ status })] });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows the assigned unit and pickup ETA while inbound", () => {
    renderPanel({ jobs: [createJob({ status: "en_route", etaToPickupSeconds: 180 })] });

    expect(screen.getByText("Unit 1 · pickup in 3m")).toBeInTheDocument();
  });

  it("switches to the dropoff ETA once carrying", () => {
    renderPanel({ jobs: [createJob({ status: "transporting", etaToDropoffSeconds: 45 })] });

    expect(screen.getByText("Unit 1 · dropoff in 45s")).toBeInTheDocument();
  });

  it("explains why a queued job has no vehicle", () => {
    renderPanel({
      jobs: [
        createJob({
          status: "pending",
          vehicleId: undefined,
          vehicleName: undefined,
          error: "Waiting for an available vehicle",
        }),
      ],
    });

    expect(screen.getByText("Waiting for an available vehicle")).toBeInTheDocument();
  });

  it("counts down to the SLA deadline for a live job", () => {
    renderPanel({ jobs: [createJob({ slaDeadline: NOW + 125_000 })] });

    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("marks time past the deadline with a leading +", () => {
    renderPanel({
      jobs: [createJob({ slaDeadline: NOW - 65_000, slaBreached: true })],
    });

    expect(screen.getByText("+1:05")).toBeInTheDocument();
    expect(screen.getByText("Late")).toBeInTheDocument();
  });

  it("hides the countdown for a finished job", () => {
    renderPanel({
      jobs: [createJob({ status: "complete", slaDeadline: NOW + 125_000 })],
      counts: { total: 1, live: 0, queued: 0, breached: 0 },
    });

    expect(screen.queryByText("2:05")).not.toBeInTheDocument();
  });

  it("offers cancel for a live job and calls it with the job id", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ jobs: [createJob()] });

    await user.click(screen.getByRole("button", { name: "Cancel job JOB-0001" }));

    expect(props.onCancelJob).toHaveBeenCalledWith("job-1");
  });

  it("offers removal instead of cancel once a job is finished", async () => {
    const user = userEvent.setup();
    const props = renderPanel({
      jobs: [createJob({ status: "complete" })],
      counts: { total: 1, live: 0, queued: 0, breached: 0 },
    });

    expect(screen.queryByRole("button", { name: /^Cancel job/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove job JOB-0001" }));

    expect(props.onDeleteJob).toHaveBeenCalledWith("job-1");
  });

  it("starts a placement from the New job button", async () => {
    const user = userEvent.setup();
    const draft = createDraft();
    renderPanel({ draft });

    await user.click(screen.getByRole("button", { name: "New job" }));

    expect(draft.start).toHaveBeenCalled();
  });

  it("tells the operator which click is next while placing", () => {
    renderPanel({ draft: createDraft({ stage: "pickup", active: true }) });

    expect(screen.getByRole("status")).toHaveTextContent("Click the map to set the pickup.");
  });

  it("asks for the dropoff once the pickup is down", () => {
    renderPanel({
      draft: createDraft({ stage: "dropoff", active: true, pickup: [-1.29, 36.82] }),
    });

    expect(screen.getByRole("status")).toHaveTextContent("Click the map to set the dropoff.");
  });

  it("swaps New job for Cancel while a placement is in flight", async () => {
    const user = userEvent.setup();
    const draft = createDraft({ stage: "pickup", active: true });
    renderPanel({ draft });

    expect(screen.queryByRole("button", { name: "New job" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(draft.cancel).toHaveBeenCalled();
  });

  it("selects the assignment strategy", async () => {
    const user = userEvent.setup();
    const draft = createDraft();
    renderPanel({ draft });

    await user.click(screen.getByRole("button", { name: "Best ETA" }));

    expect(draft.setStrategy).toHaveBeenCalledWith("best_eta");
  });

  it("marks the active strategy as pressed", () => {
    renderPanel({ draft: createDraft({ strategy: "best_eta" }) });

    expect(screen.getByRole("button", { name: "Best ETA" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Nearest" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("edits the SLA budget in minutes", () => {
    const draft = createDraft();
    renderPanel({ draft });

    // fireEvent (not user.type) because the field is controlled by the draft:
    // a mocked setter never moves `value`, so typed keystrokes would append.
    fireEvent.change(screen.getByLabelText("SLA budget in minutes"), {
      target: { value: "7" },
    });

    expect(draft.setSlaMinutes).toHaveBeenLastCalledWith(7);
  });

  it("ignores an emptied SLA field instead of committing zero", () => {
    const draft = createDraft();
    renderPanel({ draft });

    fireEvent.change(screen.getByLabelText("SLA budget in minutes"), {
      target: { value: "" },
    });

    expect(draft.setSlaMinutes).not.toHaveBeenCalled();
  });

  it("lists the newest job first", () => {
    renderPanel({
      jobs: [
        createJob({ id: "old", reference: "JOB-OLD", createdAt: NOW - 60_000 }),
        createJob({ id: "new", reference: "JOB-NEW", createdAt: NOW }),
      ],
    });

    const references = screen.getAllByText(/^JOB-(OLD|NEW)$/).map((el) => el.textContent);
    expect(references).toEqual(["JOB-NEW", "JOB-OLD"]);
  });
});

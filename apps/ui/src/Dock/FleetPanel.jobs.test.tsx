import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FleetPanel, { type FleetPanelProps } from "./FleetPanel";
import type { JobsPanelProps } from "@/Controls/JobsPanel";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
import type { JobDraft } from "@/hooks/useJobDraft";
import type { JobDTO } from "@/types";

// The vehicle list is virtualized and irrelevant here; the Jobs tab is the
// subject. Stub the leaves so this test isn't measuring react-window.
vi.mock("@/Controls/Vehicles", () => ({ default: () => <div>vehicle list</div> }));
vi.mock("@/Controls/Fleets", () => ({ default: () => <div>fleet groups</div> }));

function createJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    reference: "JOB-0001",
    status: "en_route",
    pickup: { position: [-1.29, 36.82] },
    dropoff: { position: [-1.31, 36.85] },
    strategy: "nearest",
    vehicleName: "Unit 1",
    createdAt: 1_000,
    slaSeconds: 900,
    slaDeadline: 901_000,
    slaBreached: false,
    ...overrides,
  };
}

let draft: JobDraft;
let jobs: JobsPanelProps;
let dispatch: DispatchFlow;
let onEnterDispatch: ReturnType<typeof vi.fn>;

function renderPanel(overrides: Partial<FleetPanelProps> = {}) {
  const props: FleetPanelProps = {
    vehicles: [],
    filter: "",
    onFilterChange: vi.fn(),
    onSelectVehicle: vi.fn(),
    onHoverVehicle: vi.fn(),
    onUnhoverVehicle: vi.fn(),
    maxSpeed: 60,
    vehicleFleetMap: new Map(),
    fleets: [],
    onCreateFleet: vi.fn(),
    onDeleteFleet: vi.fn(),
    onAssignVehicle: vi.fn(),
    onUnassignVehicle: vi.fn(),
    dispatch,
    onEnterDispatch,
    jobs,
    ...overrides,
  };
  render(<FleetPanel {...props} />);
  return props;
}

beforeEach(() => {
  draft = {
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
  };
  jobs = {
    jobs: [],
    counts: { total: 0, live: 0, queued: 0, breached: 0 },
    draft,
    onCancelJob: vi.fn().mockResolvedValue(undefined),
    onDeleteJob: vi.fn().mockResolvedValue(undefined),
    error: null,
  };
  onEnterDispatch = vi.fn();
  dispatch = {
    dispatchMode: false,
    dispatchState: DispatchState.BROWSE,
    selectedForDispatch: [],
    assignments: [],
    results: [],
    toggleDispatchMode: vi.fn(),
  } as unknown as DispatchFlow;
});

describe("FleetPanel — Jobs tab", () => {
  it("offers Jobs alongside the other fleet views", () => {
    renderPanel();

    expect(screen.getByRole("tab", { name: /Jobs/ })).toBeInTheDocument();
  });

  it("shows the live job count on the tab", () => {
    jobs.counts = { total: 4, live: 3, queued: 1, breached: 0 };
    renderPanel();

    expect(screen.getByRole("tab", { name: /Jobs/ })).toHaveTextContent("Jobs3");
  });

  it("opens the job board when the tab is selected", async () => {
    const user = userEvent.setup();
    jobs.jobs = [createJob()];
    jobs.counts = { total: 1, live: 1, queued: 0, breached: 0 };
    renderPanel();

    await user.click(screen.getByRole("tab", { name: /Jobs/ }));

    expect(screen.getByText("JOB-0001")).toBeInTheDocument();
    expect(screen.queryByText("vehicle list")).not.toBeInTheDocument();
  });

  it("summarises live jobs in the panel header", () => {
    jobs.counts = { total: 5, live: 2, queued: 0, breached: 0 };
    renderPanel();

    expect(screen.getByTitle("2 live jobs")).toBeInTheDocument();
  });

  it("calls out breached jobs in the header summary", () => {
    jobs.counts = { total: 5, live: 2, queued: 0, breached: 1 };
    renderPanel();

    expect(screen.getByTitle("2 live jobs, 1 past SLA")).toBeInTheDocument();
  });

  it("omits the job summary when the board is empty", () => {
    renderPanel();

    expect(screen.queryByTitle(/live jobs/)).not.toBeInTheDocument();
  });

  it("abandons a half-placed job when leaving the Jobs tab", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: /Jobs/ }));

    // Simulate the operator having placed the pickup already.
    draft.active = true;
    draft.stage = "dropoff";
    await user.click(screen.getByRole("tab", { name: /List/ }));

    expect(draft.cancel).toHaveBeenCalled();
  });

  it("does not cancel anything when leaving Jobs with no placement in flight", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: /Jobs/ }));
    await user.click(screen.getByRole("tab", { name: /List/ }));

    expect(draft.cancel).not.toHaveBeenCalled();
  });

  it("enters dispatch mode from the Dispatch tab, not the Jobs tab", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("tab", { name: /Jobs/ }));
    expect(onEnterDispatch).not.toHaveBeenCalled();

    // Entry goes through the guarded handler, not straight at the flow — a
    // half-drawn polygon elsewhere has to be asked about first.
    await user.click(screen.getByRole("tab", { name: /Dispatch/ }));
    expect(onEnterDispatch).toHaveBeenCalled();
    expect(dispatch.toggleDispatchMode).not.toHaveBeenCalled();
  });
});

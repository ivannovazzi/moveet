import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import FleetPanel, { type FleetPanelProps } from "./FleetPanel";
import type { JobsPanelProps } from "@/Controls/JobsPanel";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
import type { JobDraft } from "@/hooks/useJobDraft";
import type { JobDTO } from "@/types";

// The vehicle list is virtualized and irrelevant here; the Jobs view is the
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

/**
 * The Fleet panel is content only now — List / Groups / Dispatch / Jobs are
 * buttons on the Fleet dock, so `tab` arrives as a prop and the switching
 * behaviour is covered in `SectionRail.test.tsx`.
 */
function renderPanel(overrides: Partial<FleetPanelProps> = {}) {
  const props: FleetPanelProps = {
    tab: "list",
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
  dispatch = {
    dispatchMode: false,
    dispatchState: DispatchState.BROWSE,
    selectedForDispatch: [],
    assignments: [],
    results: [],
    error: null,
    toggleDispatchMode: vi.fn(),
  } as unknown as DispatchFlow;
});

describe("FleetPanel", () => {
  it("renders the job board for the Jobs view", () => {
    jobs.jobs = [createJob()];
    jobs.counts = { total: 1, live: 1, queued: 0, breached: 0 };
    renderPanel({ tab: "jobs" });

    expect(screen.getByText("JOB-0001")).toBeInTheDocument();
    expect(screen.queryByText("vehicle list")).not.toBeInTheDocument();
  });

  it("renders the vehicle list for List and Dispatch", () => {
    renderPanel({ tab: "list" });
    expect(screen.getByText("vehicle list")).toBeInTheDocument();
  });

  it("renders fleet groups for the Groups view", () => {
    renderPanel({ tab: "groups" });
    expect(screen.getByText("fleet groups")).toBeInTheDocument();
  });

  it("draws no tab strip of its own — the Fleet dock owns the buttons", () => {
    renderPanel();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("summarises live jobs whichever view is open", () => {
    jobs.counts = { total: 5, live: 2, queued: 0, breached: 0 };
    renderPanel({ tab: "groups" });

    expect(screen.getByTitle("2 live jobs")).toBeInTheDocument();
  });

  it("calls out breached jobs in the summary", () => {
    jobs.counts = { total: 5, live: 2, queued: 0, breached: 1 };
    renderPanel();

    expect(screen.getByTitle("2 live jobs, 1 past SLA")).toBeInTheDocument();
  });

  it("omits the job summary when the board is empty", () => {
    renderPanel();

    expect(screen.queryByTitle(/live jobs/)).not.toBeInTheDocument();
  });

  it("shows a failed dispatch's reason, which the mode rail has no room for", () => {
    dispatch = { ...dispatch, error: "No route to destination" } as DispatchFlow;
    renderPanel({ dispatch });

    expect(screen.getByText("No route to destination")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScenariosPanel from "./ScenariosPanel";
import type { ScenarioFile, ScenarioStatus } from "@/types";

const idleStatus: ScenarioStatus = {
  state: "idle",
  scenario: null,
  elapsed: 0,
  eventIndex: 0,
  eventsExecuted: 0,
  upcomingEvents: [],
};

const loadedStatus: ScenarioStatus = {
  state: "idle",
  scenario: { name: "Test Scenario", duration: 120, eventCount: 5 },
  elapsed: 0,
  eventIndex: 0,
  eventsExecuted: 0,
  upcomingEvents: [],
};

const runningStatus: ScenarioStatus = {
  state: "running",
  scenario: { name: "Test Scenario", duration: 120, eventCount: 5 },
  elapsed: 30,
  eventIndex: 2,
  eventsExecuted: 2,
  upcomingEvents: [
    { at: 45, type: "addVehicles" },
    { at: 60, type: "sendDirection" },
  ],
};

const pausedStatus: ScenarioStatus = {
  ...runningStatus,
  state: "paused",
};

const mockScenarios: ScenarioFile[] = [
  { fileName: "rush-hour.json", fileSize: 2048, modifiedAt: "2026-03-01T10:00:00Z" },
  { fileName: "night-shift.json", fileSize: 1024, modifiedAt: "2026-03-02T12:00:00Z" },
];

const mockGetScenarios = vi.fn();
const mockGetScenarioStatus = vi.fn();
const mockLoadScenarioByName = vi.fn();
const mockStartScenario = vi.fn();
const mockPauseScenario = vi.fn();
const mockStopScenario = vi.fn();
const mockOnScenarioEvent = vi.fn();
const mockOffScenarioEvent = vi.fn();

vi.mock("@/utils/client", () => ({
  default: {
    getScenarios: (...args: unknown[]) => mockGetScenarios(...args),
    getScenarioStatus: (...args: unknown[]) => mockGetScenarioStatus(...args),
    loadScenarioByName: (...args: unknown[]) => mockLoadScenarioByName(...args),
    startScenario: (...args: unknown[]) => mockStartScenario(...args),
    pauseScenario: (...args: unknown[]) => mockPauseScenario(...args),
    stopScenario: (...args: unknown[]) => mockStopScenario(...args),
    onScenarioEvent: (...args: unknown[]) => mockOnScenarioEvent(...args),
    offScenarioEvent: (...args: unknown[]) => mockOffScenarioEvent(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetScenarios.mockResolvedValue({ data: mockScenarios });
  mockGetScenarioStatus.mockResolvedValue({ data: idleStatus });
  mockLoadScenarioByName.mockResolvedValue({
    data: { status: "loaded", scenario: { name: "rush-hour", duration: 120, eventCount: 5 } },
  });
  mockStartScenario.mockResolvedValue({ data: runningStatus });
  mockPauseScenario.mockResolvedValue({ data: pausedStatus });
  mockStopScenario.mockResolvedValue({ data: idleStatus });
});

describe("ScenariosPanel", () => {
  it("renders header with title and badge", async () => {
    render(<ScenariosPanel />);

    expect(screen.getByRole("heading", { name: "Scenarios" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("renders scenario list when idle", async () => {
    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByText("rush-hour")).toBeInTheDocument();
      expect(screen.getByText("night-shift")).toBeInTheDocument();
    });
  });

  it("shows empty state when no scenarios", async () => {
    mockGetScenarios.mockResolvedValue({ data: [] });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByText("No scenarios found")).toBeInTheDocument();
    });
  });

  it("loads scenario on click", async () => {
    const user = userEvent.setup();
    mockLoadScenarioByName.mockResolvedValue({
      data: { status: "loaded", scenario: { name: "rush-hour", duration: 120, eventCount: 5 } },
    });
    // After loading, status should reflect the loaded scenario
    mockGetScenarioStatus
      .mockResolvedValueOnce({ data: idleStatus })
      .mockResolvedValue({ data: loadedStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("Load scenario rush-hour.json")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Load scenario rush-hour.json"));

    expect(mockLoadScenarioByName).toHaveBeenCalledWith("rush-hour.json");
  });

  it("shows controls when scenario loaded", async () => {
    mockGetScenarioStatus.mockResolvedValue({ data: loadedStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByText("Test Scenario")).toBeInTheDocument();
      expect(screen.getByText("5 events")).toBeInTheDocument();
      expect(screen.getByLabelText("Start scenario")).toBeInTheDocument();
    });
  });

  it("shows pause/stop controls when running", async () => {
    mockGetScenarioStatus.mockResolvedValue({ data: runningStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("Pause scenario")).toBeInTheDocument();
      expect(screen.getByLabelText("Stop scenario")).toBeInTheDocument();
    });
  });

  it("shows resume/stop controls when paused", async () => {
    mockGetScenarioStatus.mockResolvedValue({ data: pausedStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("Resume scenario")).toBeInTheDocument();
      expect(screen.getByLabelText("Stop scenario")).toBeInTheDocument();
    });
  });

  it("shows progress bar when running", async () => {
    mockGetScenarioStatus.mockResolvedValue({ data: runningStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText("2 / 5 events")).toBeInTheDocument();
    });
  });

  it("shows upcoming events when running", async () => {
    mockGetScenarioStatus.mockResolvedValue({ data: runningStatus });

    render(<ScenariosPanel />);

    await waitFor(() => {
      expect(screen.getByText("Upcoming")).toBeInTheDocument();
      expect(screen.getByText("addVehicles")).toBeInTheDocument();
      expect(screen.getByText("sendDirection")).toBeInTheDocument();
    });
  });

  it("subscribes and unsubscribes to scenario events", () => {
    const { unmount } = render(<ScenariosPanel />);

    expect(mockOnScenarioEvent).toHaveBeenCalledOnce();

    unmount();

    expect(mockOffScenarioEvent).toHaveBeenCalledOnce();
  });
});

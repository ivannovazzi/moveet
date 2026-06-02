import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordReplay from "./RecordReplay";
import type { RecordingFile, ReplayStatus } from "@/types";

// ─── Mocks ──────────────────────────────────────────────────────────

const mockGenerateRecording = vi.fn();
const mockGetGenerateStatus = vi.fn();
const mockOnGenerateProgress = vi.fn();
const mockOffGenerateProgress = vi.fn();
const mockOnGenerateComplete = vi.fn();
const mockOffGenerateComplete = vi.fn();
const mockOnGenerateError = vi.fn();
const mockOffGenerateError = vi.fn();

vi.mock("@/utils/client", () => ({
  default: {
    generateRecording: (...a: unknown[]) => mockGenerateRecording(...a),
    getGenerateStatus: (...a: unknown[]) => mockGetGenerateStatus(...a),
    onGenerateProgress: (...a: unknown[]) => mockOnGenerateProgress(...a),
    offGenerateProgress: (...a: unknown[]) => mockOffGenerateProgress(...a),
    onGenerateComplete: (...a: unknown[]) => mockOnGenerateComplete(...a),
    offGenerateComplete: (...a: unknown[]) => mockOffGenerateComplete(...a),
    onGenerateError: (...a: unknown[]) => mockOnGenerateError(...a),
    offGenerateError: (...a: unknown[]) => mockOffGenerateError(...a),
  },
}));

const mockEmitRecording = vi.fn();
const mockGetEmitStatus = vi.fn();

vi.mock("./Adapter/adapterClient", () => ({
  emitRecording: (...a: unknown[]) => mockEmitRecording(...a),
  getEmitStatus: (...a: unknown[]) => mockGetEmitStatus(...a),
  AdapterHttpError: class AdapterHttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────────

const idleReplay: ReplayStatus = { mode: "live" } as ReplayStatus;

const recordings: RecordingFile[] = [
  {
    id: 1,
    fileName: "moveet-2026-20v.ndjson",
    fileSize: 5000,
    modifiedAt: "2026-05-25T00:00:00Z",
    vehicleCount: 20,
    generated: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGenerateStatus.mockResolvedValue({ data: { state: "idle" } });
  mockGenerateRecording.mockResolvedValue({ data: { status: "generating", jobId: "j1" } });
  mockEmitRecording.mockResolvedValue({ status: "emitting", jobId: "e1" });
  mockGetEmitStatus.mockResolvedValue({ state: "idle", emitted: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPanel(overrides?: Partial<React.ComponentProps<typeof RecordReplay>>) {
  return render(
    <RecordReplay
      recordings={recordings}
      replayStatus={idleReplay}
      onStartReplay={vi.fn()}
      onRefreshRecordings={vi.fn()}
      {...overrides}
    />
  );
}

describe("RecordReplay — generate historical", () => {
  it("renders the generate form", async () => {
    renderPanel();
    expect(screen.getByText("Generate historical")).toBeInTheDocument();
    expect(screen.getByLabelText("Duration in hours")).toBeInTheDocument();
    expect(screen.getByLabelText("Vehicle count")).toBeInTheDocument();
    expect(screen.getByLabelText("Generate historical recording")).toBeInTheDocument();
  });

  it("resyncs a running job on mount via getGenerateStatus", async () => {
    mockGetGenerateStatus.mockResolvedValue({
      data: { state: "running", jobId: "j9", step: 5, totalSteps: 10, pct: 50 },
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });
    expect(screen.getByText("Step 5 / 10")).toBeInTheDocument();
  });

  it("calls generateRecording with ISO start and stepMs on submit", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText("Generate historical recording"));

    expect(mockGenerateRecording).toHaveBeenCalledOnce();
    const body = mockGenerateRecording.mock.calls[0][0];
    expect(typeof body.startTime).toBe("string");
    expect(body.startTime).toMatch(/\dT.*Z$/);
    expect(body.stepMs).toBe(1000); // default 1s
    expect(body.hours).toBe(24);
    expect(body.vehicleCount).toBe(20);
  });

  it("subscribes to generate WS events on mount and unsubscribes on unmount", () => {
    const { unmount } = renderPanel();
    expect(mockOnGenerateProgress).toHaveBeenCalledOnce();
    expect(mockOnGenerateComplete).toHaveBeenCalledOnce();
    expect(mockOnGenerateError).toHaveBeenCalledOnce();

    unmount();
    expect(mockOffGenerateProgress).toHaveBeenCalledOnce();
    expect(mockOffGenerateComplete).toHaveBeenCalledOnce();
    expect(mockOffGenerateError).toHaveBeenCalledOnce();
  });

  it("shows progress on generate:progress and refreshes on generate:complete", async () => {
    const onRefreshRecordings = vi.fn();
    renderPanel({ onRefreshRecordings });

    const progressHandler = mockOnGenerateProgress.mock.calls[0][0] as (d: unknown) => void;
    const completeHandler = mockOnGenerateComplete.mock.calls[0][0] as (d: unknown) => void;

    act(() => {
      progressHandler({ jobId: "j1", step: 3, totalSteps: 12, pct: 25 });
    });
    expect(screen.getByText("Step 3 / 12")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();

    act(() => {
      completeHandler({ jobId: "j1", recording: recordings[0] });
    });
    expect(onRefreshRecordings).toHaveBeenCalledOnce();
    expect(screen.queryByText("Step 3 / 12")).not.toBeInTheDocument();
  });

  it("shows the error on generate:error", async () => {
    renderPanel();
    const errorHandler = mockOnGenerateError.mock.calls[0][0] as (d: unknown) => void;

    act(() => {
      errorHandler({ jobId: "j1", error: "boom" });
    });

    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

describe("RecordReplay — emit to sinks", () => {
  it("emits with the recording id and realism on by default, then polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetEmitStatus
      .mockResolvedValueOnce({ state: "emitting", emitted: 5, total: 10, pct: 50 })
      .mockResolvedValue({ state: "done", emitted: 10, total: 10, pct: 100 });

    renderPanel();

    await user.click(screen.getByLabelText(/Emit recording .* to sinks/));

    expect(mockEmitRecording).toHaveBeenCalledWith({ recordingId: 1, realism: "on" });

    await waitFor(() => {
      expect(screen.getByText("5 / 10")).toBeInTheDocument();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => {
      expect(screen.getByText("Emitted 10 fixes")).toBeInTheDocument();
    });
  });

  it("emits with realism off when toggle unchecked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText("Realism")); // uncheck
    await user.click(screen.getByLabelText(/Emit recording .* to sinks/));

    expect(mockEmitRecording).toHaveBeenCalledWith({ recordingId: 1, realism: "off" });
  });

  it("handles a 409 (already emitting) by entering the emitting state", async () => {
    const { AdapterHttpError } = await import("./Adapter/adapterClient");
    mockEmitRecording.mockRejectedValue(new AdapterHttpError("conflict", 409));
    mockGetEmitStatus.mockResolvedValue({ state: "emitting", emitted: 2, total: 4, pct: 50 });

    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText(/Emit recording .* to sinks/));

    await waitFor(() => {
      expect(screen.getByText("2 / 4")).toBeInTheDocument();
    });
  });
});

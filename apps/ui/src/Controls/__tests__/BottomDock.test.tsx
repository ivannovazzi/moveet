import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReplayStatus, SimulationStatus, ClockState } from "@/types";
import { DEFAULT_START_OPTIONS } from "@/data/constants";

vi.mock("@/utils/client", () => ({
  default: {
    start: vi.fn().mockResolvedValue({ data: undefined }),
    stop: vi.fn().mockResolvedValue({ data: undefined }),
    reset: vi.fn().mockResolvedValue({ data: undefined }),
    makeHeatzones: vi.fn().mockResolvedValue({ data: undefined }),
    getOptions: vi.fn().mockResolvedValue({ data: undefined }),
    onOptions: vi.fn(),
    getClock: vi.fn().mockResolvedValue({ data: undefined }),
    setClock: vi.fn().mockResolvedValue({ data: undefined }),
    onClock: vi.fn(),
    offClock: vi.fn(),
  },
}));

import BottomDock from "../BottomDock";
import client from "@/utils/client";

const CLOCK: ClockState = {
  currentTime: "2026-07-02T07:00:00.000Z",
  speedMultiplier: 1,
  hour: 7,
  timeOfDay: "morning_rush",
};

function defaultProps(
  overrides: Partial<React.ComponentProps<typeof BottomDock>> = {}
): React.ComponentProps<typeof BottomDock> {
  return {
    status: { running: false, interval: 500, ready: true } as SimulationStatus,
    connected: true,
    replayStatus: { mode: "live" } as ReplayStatus,
    onPauseReplay: vi.fn(),
    onResumeReplay: vi.fn(),
    onStopReplay: vi.fn(),
    onSeekReplay: vi.fn(),
    onSetReplaySpeed: vi.fn(),
    isRecording: false,
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getOptions).mockResolvedValue({ data: DEFAULT_START_OPTIONS });
  vi.mocked(client.onOptions).mockImplementation(() => {});
  vi.mocked(client.getClock).mockResolvedValue({ data: CLOCK });
  vi.mocked(client.onClock).mockImplementation(() => {});
  vi.mocked(client.offClock).mockImplementation(() => {});
  vi.mocked(client.setClock).mockResolvedValue({ data: CLOCK });
});

describe("BottomDock", () => {
  it("renders with default props", () => {
    render(<BottomDock {...defaultProps()} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make zones" })).toBeInTheDocument();
  });

  it("calls client.start when the Start button is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomDock {...defaultProps()} />);

    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("calls setSpeedMultiplier (client.setClock) when a speed-preset button is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomDock {...defaultProps()} />);

    await user.click(screen.getByRole("button", { name: "60×" }));

    expect(client.setClock).toHaveBeenCalledWith({ speedMultiplier: 60 });
  });
});

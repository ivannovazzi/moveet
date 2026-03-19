import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Incidents from "./Incidents";
import type { IncidentDTO } from "@/types";

const mockIncident = (overrides?: Partial<IncidentDTO>): IncidentDTO => ({
  id: "inc-1",
  edgeIds: ["edge-1", "edge-2"],
  type: "accident",
  severity: 0.7,
  speedFactor: 0.3,
  startTime: Date.now() - 60000,
  duration: 180000,
  expiresAt: Date.now() + 120000,
  autoClears: true,
  position: [-1.286, 36.817],
  ...overrides,
});

const noop = vi.fn(() => Promise.resolve());

describe("Incidents", () => {
  it("renders header with title", () => {
    render(<Incidents incidents={[]} createRandom={noop} remove={noop} />);
    expect(screen.getByRole("heading", { name: "Incidents" })).toBeInTheDocument();
  });

  it("shows empty state when no incidents", () => {
    render(<Incidents incidents={[]} createRandom={noop} remove={noop} />);
    expect(screen.getByText("No active incidents")).toBeInTheDocument();
  });

  it("renders incident items with type labels", () => {
    const incidents = [
      mockIncident({ id: "inc-1", type: "accident" }),
      mockIncident({ id: "inc-2", type: "closure" }),
      mockIncident({ id: "inc-3", type: "construction" }),
    ];
    render(<Incidents incidents={incidents} createRandom={noop} remove={noop} />);
    expect(screen.getByText("accident")).toBeInTheDocument();
    expect(screen.getByText("closure")).toBeInTheDocument();
    expect(screen.getByText("construction")).toBeInTheDocument();
  });

  it("shows severity bar with correct width", () => {
    const incident = mockIncident({ severity: 0.5 });
    render(<Incidents incidents={[incident]} createRandom={noop} remove={noop} />);
    // The severityFill div has an inline style with width based on severity
    const typeLabel = screen.getByText("accident");
    // Navigate up to the .incident container, then find the severity fill
    const incidentRow = typeLabel.closest("[class]")!.parentElement!;
    const severityFill = incidentRow.querySelector("[style*='width']");
    expect(severityFill).not.toBeNull();
    expect(severityFill).toHaveStyle({ width: "50%" });
  });

  it("calls createRandom when create button clicked", async () => {
    const createRandom = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<Incidents incidents={[]} createRandom={createRandom} remove={noop} />);
    await user.click(screen.getByRole("button", { name: "Create incident" }));
    expect(createRandom).toHaveBeenCalledOnce();
  });

  it("calls remove when remove button clicked", async () => {
    const remove = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    const incident = mockIncident({ id: "inc-42" });
    render(<Incidents incidents={[incident]} createRandom={noop} remove={remove} />);
    await user.click(screen.getByTitle("Remove incident"));
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("inc-42");
  });

  it("shows time remaining", () => {
    const incident = mockIncident({ expiresAt: Date.now() + 60000 });
    render(<Incidents incidents={[incident]} createRandom={noop} remove={noop} />);
    // 60 seconds from now should display as "1m 0s" or "59s" depending on timing
    const timeEl = screen.getByText(/^(1m 0s|59s)$/);
    expect(timeEl).toBeInTheDocument();
  });
});

describe("Incidents — auto-generate interval cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Seed Math.random to get a deterministic interval delay
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Toggle auto-generate switch via userEvent (works with shouldAdvanceTime). */
  async function toggleAutoGenerate() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const toggle = screen.getByRole("switch", { name: "Auto-generate incidents" });
    await user.click(toggle);
  }

  it("calls createRandom immediately when auto-generate is enabled", async () => {
    const createRandom = vi.fn(() => Promise.resolve());

    render(<Incidents incidents={[]} createRandom={createRandom} remove={noop} />);

    await toggleAutoGenerate();

    // createRandom is called immediately when autoGenerate turns on
    expect(createRandom).toHaveBeenCalledOnce();
  });

  it("calls createRandom on interval ticks when auto-generate is enabled", async () => {
    const createRandom = vi.fn(() => Promise.resolve());

    render(<Incidents incidents={[]} createRandom={createRandom} remove={noop} />);

    await toggleAutoGenerate();
    expect(createRandom).toHaveBeenCalledTimes(1);

    // With Math.random() = 0.5, interval = 15000 + 0.5 * 15000 = 22500ms
    act(() => {
      vi.advanceTimersByTime(22500);
    });

    expect(createRandom).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(22500);
    });

    expect(createRandom).toHaveBeenCalledTimes(3);
  });

  it("clears interval when auto-generate is toggled off", async () => {
    const createRandom = vi.fn(() => Promise.resolve());

    render(<Incidents incidents={[]} createRandom={createRandom} remove={noop} />);

    await toggleAutoGenerate(); // on
    expect(createRandom).toHaveBeenCalledTimes(1);

    await toggleAutoGenerate(); // off

    // Advance time well past the interval — no more calls should happen
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(createRandom).toHaveBeenCalledTimes(1);
  });

  it("clears interval on unmount", async () => {
    const createRandom = vi.fn(() => Promise.resolve());

    const { unmount } = render(
      <Incidents incidents={[]} createRandom={createRandom} remove={noop} />,
    );

    await toggleAutoGenerate();
    expect(createRandom).toHaveBeenCalledTimes(1);

    unmount();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(createRandom).toHaveBeenCalledTimes(1);
  });

  it("does not stack intervals on rapid toggling", async () => {
    const createRandom = vi.fn(() => Promise.resolve());

    render(<Incidents incidents={[]} createRandom={createRandom} remove={noop} />);

    await toggleAutoGenerate(); // on
    await toggleAutoGenerate(); // off
    await toggleAutoGenerate(); // on — final state: on

    const callsAfterToggles = createRandom.mock.calls.length;
    expect(callsAfterToggles).toBe(2); // two on-toggles

    act(() => {
      vi.advanceTimersByTime(22500);
    });

    // Only 1 additional call from the single active interval
    expect(createRandom).toHaveBeenCalledTimes(callsAfterToggles + 1);
  });

  it("uses latest createRandom ref without restarting the interval", async () => {
    const createRandom1 = vi.fn(() => Promise.resolve());
    const createRandom2 = vi.fn(() => Promise.resolve());

    const { rerender } = render(
      <Incidents incidents={[]} createRandom={createRandom1} remove={noop} />,
    );

    await toggleAutoGenerate();
    expect(createRandom1).toHaveBeenCalledTimes(1);
    expect(createRandom2).not.toHaveBeenCalled();

    // Swap the createRandom prop — the ref should update without restarting interval
    rerender(<Incidents incidents={[]} createRandom={createRandom2} remove={noop} />);

    act(() => {
      vi.advanceTimersByTime(22500);
    });

    // The interval callback should now call createRandom2 via the ref
    expect(createRandom2).toHaveBeenCalledTimes(1);
    expect(createRandom1).toHaveBeenCalledTimes(1);
  });
});

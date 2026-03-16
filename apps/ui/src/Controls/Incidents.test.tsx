import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NavRail from "../NavRail";

describe("NavRail", () => {
  it("renders labeled nav items grouped under Fleet, Operations, and Monitor headers", () => {
    render(<NavRail activePanel={null} onPanelChange={vi.fn()} />);
    expect(screen.getByText("Fleet")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Monitor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vehicles" })).toBeInTheDocument();
    // Speed and Clock are no longer nav destinations.
    expect(screen.queryByRole("button", { name: "Speed" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simulation Clock" })).not.toBeInTheDocument();
  });

  it("calls onPanelChange with the clicked panel id, toggling off if already active", async () => {
    const onPanelChange = vi.fn();
    render(<NavRail activePanel={null} onPanelChange={onPanelChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Vehicles" }));
    expect(onPanelChange).toHaveBeenCalledWith("vehicles");
  });

  it("shows the incident count badge on the Incidents item", () => {
    render(<NavRail activePanel={null} onPanelChange={vi.fn()} incidentCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

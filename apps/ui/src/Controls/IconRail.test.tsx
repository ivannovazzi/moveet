import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IconRail from "./IconRail";

describe("IconRail", () => {
  it("renders all navigation buttons", () => {
    render(<IconRail activePanel={null} onPanelChange={() => {}} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);

    expect(screen.getByLabelText("Vehicles")).toBeInTheDocument();
    expect(screen.getByLabelText("Fleets")).toBeInTheDocument();
    expect(screen.getByLabelText("Incidents")).toBeInTheDocument();
    expect(screen.getByLabelText("Recordings")).toBeInTheDocument();
    expect(screen.getByLabelText("Visibility")).toBeInTheDocument();
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByLabelText("Adapter")).toBeInTheDocument();
  });

  it("calls onPanelChange with panel id when clicking inactive button", async () => {
    const onPanelChange = vi.fn();
    render(<IconRail activePanel={null} onPanelChange={onPanelChange} />);

    await userEvent.click(screen.getByLabelText("Fleets"));

    expect(onPanelChange).toHaveBeenCalledWith("fleets");
  });

  it("calls onPanelChange with null when clicking active button (toggle off)", async () => {
    const onPanelChange = vi.fn();
    render(<IconRail activePanel="vehicles" onPanelChange={onPanelChange} />);

    await userEvent.click(screen.getByLabelText("Vehicles"));

    expect(onPanelChange).toHaveBeenCalledWith(null);
  });

  it("marks active button with aria-pressed=true", () => {
    render(<IconRail activePanel="incidents" onPanelChange={() => {}} />);

    expect(screen.getByLabelText("Incidents")).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByLabelText("Vehicles")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Fleets")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Recordings")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows incident badge when incidentCount > 0", () => {
    render(<IconRail activePanel={null} onPanelChange={() => {}} incidentCount={3} />);

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows 9+ for incident count > 9", () => {
    render(<IconRail activePanel={null} onPanelChange={() => {}} incidentCount={15} />);

    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("does not show badge when incidentCount is 0", () => {
    render(<IconRail activePanel={null} onPanelChange={() => {}} incidentCount={0} />);

    const incidentsButton = screen.getByLabelText("Incidents");
    expect(incidentsButton.querySelector("span")).toBeNull();
  });
});

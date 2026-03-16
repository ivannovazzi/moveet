import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Fleets from "./Fleets";
import type { Fleet } from "@/types";

const mockFleet = (overrides?: Partial<Fleet>): Fleet => ({
  id: "fleet-1",
  name: "Fleet Alpha",
  color: "#ff0000",
  vehicleIds: ["v1", "v2"],
  source: "local",
  ...overrides,
});

const noop = vi.fn(() => Promise.resolve());

describe("Fleets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header with title", () => {
    render(<Fleets fleets={[]} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.getByRole("heading", { name: "Fleets" })).toBeInTheDocument();
  });

  it("shows empty state when no fleets", () => {
    render(<Fleets fleets={[]} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.getByText("No fleets defined")).toBeInTheDocument();
  });

  it("renders fleet items", () => {
    const fleets = [
      mockFleet({ id: "f1", name: "Alpha", vehicleIds: ["v1", "v2"] }),
      mockFleet({ id: "f2", name: "Bravo", vehicleIds: ["v3"] }),
    ];
    render(<Fleets fleets={fleets} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("2 fleet groups available")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows delete button for local fleets", () => {
    const fleets = [mockFleet({ source: "local" })];
    render(<Fleets fleets={fleets} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.getByTitle("Delete fleet")).toBeInTheDocument();
  });

  it("shows 'ext' label for external fleets", () => {
    const fleets = [mockFleet({ source: "external" })];
    render(<Fleets fleets={fleets} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.getByText("ext")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete fleet" })).not.toBeInTheDocument();
  });

  it("calls onDeleteFleet when delete clicked", async () => {
    const onDelete = vi.fn(() => Promise.resolve());
    const fleets = [mockFleet({ id: "fleet-42" })];
    render(<Fleets fleets={fleets} onCreateFleet={noop} onDeleteFleet={onDelete} />);

    await userEvent.click(screen.getByTitle("Delete fleet"));
    expect(onDelete).toHaveBeenCalledWith("fleet-42");
  });

  it("shows input when '+ New' clicked", async () => {
    render(<Fleets fleets={[]} onCreateFleet={noop} onDeleteFleet={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(screen.getByPlaceholderText("Fleet name...")).toBeInTheDocument();
  });

  it("calls onCreateFleet on Enter", async () => {
    const onCreate = vi.fn(() => Promise.resolve());
    render(<Fleets fleets={[]} onCreateFleet={onCreate} onDeleteFleet={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    const input = screen.getByPlaceholderText("Fleet name...");
    await userEvent.type(input, "Alpha{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Alpha");
  });

  it("hides input on Escape", async () => {
    render(<Fleets fleets={[]} onCreateFleet={noop} onDeleteFleet={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    const input = screen.getByPlaceholderText("Fleet name...");
    expect(input).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Fleet name...")).not.toBeInTheDocument();
  });

  it("hides '+ New' button when 10 fleets exist", () => {
    const fleets = Array.from({ length: 10 }, (_, i) =>
      mockFleet({ id: `fleet-${i}`, name: `Fleet ${i}` })
    );
    render(<Fleets fleets={fleets} onCreateFleet={noop} onDeleteFleet={noop} />);
    expect(screen.queryByRole("button", { name: "+ New" })).not.toBeInTheDocument();
  });
});

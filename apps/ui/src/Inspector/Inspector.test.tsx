import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inspector from "./Inspector";
import { createVehicle, createPOI } from "@/test/mocks/types";
import type { Fleet, Route } from "@/types";

describe("Inspector", () => {
  it("renders nothing when neither a vehicle nor a POI is selected", () => {
    const { container } = render(<Inspector onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders vehicle details when a vehicle is selected", () => {
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1", name: "Test Vehicle 1", speed: 42, heading: 90 })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Test Vehicle 1")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText(/42 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/90°/)).toBeInTheDocument();
    expect(screen.getByText("En route")).toBeInTheDocument();
  });

  it("shows Idle status for a stopped vehicle", () => {
    render(<Inspector vehicle={createVehicle({ speed: 0 })} onClose={vi.fn()} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("prefers the resolved fleet name and shows the route distance when provided", () => {
    const fleet: Fleet = {
      id: "f1",
      name: "North Fleet",
      color: "#fff",
      source: "local",
      vehicleIds: ["v1"],
    };
    const route: Route = { edges: [], distance: 3.4 };
    render(
      <Inspector
        vehicle={createVehicle({ id: "v1" })}
        fleet={fleet}
        route={route}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("North Fleet")).toBeInTheDocument();
    expect(screen.getByText("3.4 km")).toBeInTheDocument();
  });

  it("renders POI details, falling back gracefully when the name is null", () => {
    render(
      <Inspector
        poi={createPOI({ id: "poi1", name: null, type: "restaurant" })}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Point of interest")).toBeInTheDocument();
    expect(screen.getByText("restaurant")).toBeInTheDocument();
    expect(screen.getByText("poi1")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<Inspector vehicle={createVehicle()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(<Inspector vehicle={createVehicle()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Inspector from "../Inspector";

vi.mock("@/data/useData", () => ({
  useDirectionContext: () => ({ directions: new Map() }),
}));

describe("Inspector", () => {
  it("renders nothing when no vehicle or POI is selected", () => {
    const { container } = render(
      <Inspector vehicle={null} vehicleFleet={undefined} poi={null} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders vehicle details when a vehicle is selected", () => {
    render(
      <Inspector
        vehicle={{ id: "v1", name: "Test Vehicle 1", type: "car", speed: 42 } as never}
        vehicleFleet={undefined}
        poi={null}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Test Vehicle 1")).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Inspector
        vehicle={{ id: "v1", name: "Test Vehicle 1", type: "car", speed: 42 } as never}
        vehicleFleet={undefined}
        poi={null}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders POI details when a POI is selected and falls back gracefully when name is null", () => {
    render(
      <Inspector
        vehicle={null}
        vehicleFleet={undefined}
        poi={{ id: "poi1", name: null, coordinates: [0, 0], type: "restaurant" } as never}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/restaurant/i)).toBeInTheDocument();
  });
});

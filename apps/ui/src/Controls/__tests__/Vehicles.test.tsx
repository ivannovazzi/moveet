import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VehicleList from "../Vehicles";

vi.mock("@/data/useData", () => ({
  useDirectionContext: () => ({ directions: new Map() }),
}));

const baseVehicle = {
  id: "v1",
  name: "Test Vehicle 1",
  type: "car",
  speed: 42,
  visible: true,
  selected: false,
  hovered: false,
} as const;

describe("VehicleList", () => {
  it("renders a row with tabular-nums on both speed and route distance", () => {
    render(
      <VehicleList
        filter=""
        vehicles={[baseVehicle as never]}
        maxSpeed={100}
        onFilterChange={vi.fn()}
        onSelectVehicle={vi.fn()}
        onHoverVehicle={vi.fn()}
        onUnhoverVehicle={vi.fn()}
        vehicleFleetMap={new Map()}
      />
    );
    const row = screen.getByRole("button", { name: /Test Vehicle 1/ });
    const routeText = screen.getByText("No route");
    expect(routeText.className).toContain("tabular-nums");
    expect(row.className).not.toContain("bg-white/[0.03]"); // old card treatment removed
  });
});

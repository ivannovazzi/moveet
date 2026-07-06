import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import Inspector from "../Inspector";
import { SelectionContext, type SelectionApi } from "@/hooks/useSelection";
import type { Fleet, Vehicle } from "@/types";

vi.mock("@/data/useData", () => ({
  useDirectionContext: () => ({ directions: new Map() }),
}));

const vehicle = { id: "v1", name: "Test Vehicle 1", type: "car", speed: 42 } as Vehicle;
const poi = { id: "poi1", name: null, coordinates: [0, 0], type: "restaurant" };

function makeSelection(overrides: Partial<SelectionApi> = {}): SelectionApi {
  return {
    selection: null,
    selectedItem: null,
    select: vi.fn(),
    selectItem: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

function renderInspector(
  selection: SelectionApi,
  { vehicles = [vehicle], fleetMap = new Map<string, Fleet>() } = {}
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>
  );
  return render(<Inspector vehicles={vehicles} vehicleFleetMap={fleetMap} />, { wrapper });
}

describe("Inspector", () => {
  it("renders nothing when nothing is selected", () => {
    const { container } = renderInspector(makeSelection());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders vehicle details when a vehicle is selected", () => {
    renderInspector(makeSelection({ selection: { kind: "vehicle", id: "v1" } }));
    expect(screen.getByText("Test Vehicle 1")).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renders nothing when the selected vehicle is not in the list yet", () => {
    const { container } = renderInspector(
      makeSelection({ selection: { kind: "vehicle", id: "missing" } })
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the vehicle's fleet name from the fleet map", () => {
    const fleet = { id: "f1", name: "North Fleet", color: "#fff", vehicleIds: ["v1"] } as Fleet;
    renderInspector(makeSelection({ selection: { kind: "vehicle", id: "v1" } }), {
      fleetMap: new Map([["v1", fleet]]),
    });
    expect(screen.getByText("North Fleet")).toBeInTheDocument();
  });

  it("clears the unified selection when the close button is clicked", async () => {
    const clear = vi.fn();
    renderInspector(makeSelection({ selection: { kind: "vehicle", id: "v1" }, clear }));
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(clear).toHaveBeenCalled();
  });

  it("renders POI details when a POI is selected and falls back gracefully when name is null", () => {
    renderInspector(
      makeSelection({
        selection: { kind: "poi", id: "poi1" },
        selectedItem: poi as never,
      })
    );
    expect(screen.getByText(/restaurant/i)).toBeInTheDocument();
    expect(screen.getByText("Point of interest")).toBeInTheDocument();
  });

  it("renders nothing for a road selection", () => {
    const road = { name: "Moi Avenue", nodeIds: new Set<string>(), streets: [] };
    const { container } = renderInspector(
      makeSelection({
        selection: { kind: "road", id: "Moi Avenue" },
        selectedItem: road as never,
      })
    );
    expect(container).toBeEmptyDOMElement();
  });
});

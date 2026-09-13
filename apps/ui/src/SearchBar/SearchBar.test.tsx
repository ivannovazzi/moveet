import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createPOI, createRoad, createVehicle } from "@/test/mocks/types";
import SearchBar from "./index";

const roads = [createRoad({ name: "Simba Road" }), createRoad({ name: "Ngong Road" })];
const pois = [
  createPOI({ id: "p1", name: "Simmers Place" }),
  createPOI({ id: "p2", name: "Java House" }),
];

vi.mock("@/hooks/useRoads", () => ({
  useRoads: () => ({ roads, loading: false }),
}));
vi.mock("@/hooks/usePois", () => ({
  usePois: () => ({ pois }),
}));

const vehicles = [
  createVehicle({ id: "v1", name: "Sim Van", speed: 42 }),
  createVehicle({ id: "v2", name: "Truck Alpha", speed: 0 }),
];

function setup(overrides: Partial<React.ComponentProps<typeof SearchBar>> = {}) {
  const onDestinationClick = vi.fn();
  const onItemSelect = vi.fn();
  const onItemUnselect = vi.fn();
  const onSelectVehicle = vi.fn();

  const utils = render(
    <SearchBar
      selectedItem={null}
      onDestinationClick={onDestinationClick}
      onItemSelect={onItemSelect}
      onItemUnselect={onItemUnselect}
      vehicles={vehicles}
      onSelectVehicle={onSelectVehicle}
      {...overrides}
    />
  );

  return { ...utils, onDestinationClick, onItemSelect, onItemUnselect, onSelectVehicle };
}

function getInput() {
  return screen.getByRole("textbox", { name: "Search" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchBar grouping", () => {
  it("renders grouped results for a mixed query", () => {
    setup();
    const input = getInput();

    fireEvent.change(input, { target: { value: "sim" } });

    const groupText = (name: string) =>
      within(screen.getByRole("group", { name }))
        .getAllByRole("option")
        .map((o) => o.textContent ?? "")
        .join("|");

    expect(groupText("Vehicles")).toContain("Sim Van");
    expect(groupText("Roads")).toContain("Simba Road");
    expect(groupText("Places")).toContain("Simmers Place");
    expect(screen.queryByText("Truck Alpha")).not.toBeInTheDocument();
  });
});

describe("SearchBar vehicle selection", () => {
  it("calls onSelectVehicle and sets the input text when a vehicle row is chosen", () => {
    const { onSelectVehicle } = setup();
    const input = getInput();

    fireEvent.change(input, { target: { value: "sim van" } });
    const option = screen.getByRole("option", { name: /Sim Van/ });
    fireEvent.mouseDown(option);

    expect(onSelectVehicle).toHaveBeenCalledWith("v1");
    expect(input).toHaveValue("Sim Van");
  });
});

describe("SearchBar empty state", () => {
  it("shows a quiet empty-state row when nothing matches", () => {
    setup();
    const input = getInput();

    fireEvent.change(input, { target: { value: "zzzzzz" } });

    expect(screen.getByText("No matches for “zzzzzz”")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("SearchBar keyboard navigation", () => {
  it("moves the highlight with arrow keys and commits with Enter", () => {
    const { onItemSelect } = setup();
    const input = getInput();

    fireEvent.change(input, { target: { value: "sim" } });
    // Rows: Sim Van (vehicle, index 0), Simba Road (road, index 1), Simmers Place (place, index 2)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onItemSelect).toHaveBeenCalledWith(roads[0]);
  });
});

describe("SearchBar clear", () => {
  it("calls onItemUnselect when the clear button is pressed", () => {
    const { onItemUnselect } = setup();
    const input = getInput();

    fireEvent.change(input, { target: { value: "sim" } });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Clear" }));

    expect(onItemUnselect).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createPOI, createRoad, createVehicle } from "@/test/mocks/types";
import CommandPalette from "./CommandPalette";
import type { PaletteAction } from "./types";

const vehicles = [
  createVehicle({ id: "v1", name: "Sim Van", speed: 42 }),
  createVehicle({ id: "v2", name: "Truck Alpha" }),
];
const roads = [createRoad({ name: "Simba Road" }), createRoad({ name: "Ngong Road" })];
const pois = [
  createPOI({ id: "p1", name: "Simmers Place" }),
  createPOI({ id: "p2", name: "Java House" }),
];

function setup(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const onStart = vi.fn();
  const onMonitor = vi.fn();
  const onSelectVehicle = vi.fn();
  const onSelectItem = vi.fn();

  const actions: PaletteAction[] = [
    {
      id: "sim-start",
      label: "Start simulation",
      keywords: "play run",
      hint: "Simulation",
      run: onStart,
    },
    { id: "panel-monitor", label: "Open Monitor panel", hint: "Panel", run: onMonitor },
  ];

  const utils = render(
    <CommandPalette
      vehicles={vehicles}
      roads={roads}
      pois={pois}
      actions={actions}
      onSelectVehicle={onSelectVehicle}
      onSelectItem={onSelectItem}
      {...overrides}
    />
  );

  return { ...utils, onStart, onMonitor, onSelectVehicle, onSelectItem };
}

/** Fire the platform palette chord at the document. */
function pressChord(key = "k", init: KeyboardEventInit = { metaKey: true }) {
  fireEvent.keyDown(document, { key, ...init });
}

function openPalette() {
  pressChord();
  return screen.getByRole("combobox");
}

function optionLabels() {
  return screen.queryAllByRole("option").map((o) => o.textContent);
}

function highlighted() {
  return screen.queryAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandPalette shortcut", () => {
  it("is closed until the ⌘K chord is pressed", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressChord();

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("also opens with Ctrl+K for non-Mac keyboards", () => {
    setup();
    pressChord("k", { ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("toggles closed when the chord is pressed again", () => {
    setup();
    pressChord();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressChord();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a bare k so typing is unaffected", () => {
    setup();
    fireEvent.keyDown(document, { key: "k" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("CommandPalette filtering", () => {
  it("lists every action and no entities on an empty query", () => {
    setup();
    openPalette();

    expect(optionLabels()).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Start simulation/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Open Monitor panel/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Vehicles" })).not.toBeInTheDocument();
  });

  it("filters across actions AND entities, grouped by kind", () => {
    setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "sim" } });

    // Matched runs are wrapped in <mark>, so assert on each option's rendered
    // text rather than on the (whitespace-split) accessible name.
    const groupText = (name: string) =>
      within(screen.getByRole("group", { name }))
        .getAllByRole("option")
        .map((o) => o.textContent ?? "")
        .join("|");

    expect(groupText("Actions")).toContain("Start simulation");
    expect(groupText("Actions")).not.toContain("Open Monitor panel");
    expect(groupText("Vehicles")).toContain("Sim Van");
    expect(groupText("Roads")).toContain("Simba Road");
    expect(groupText("Places")).toContain("Simmers Place");

    // Non-matching entities are excluded.
    expect(screen.queryByText("Truck Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Ngong Road")).not.toBeInTheDocument();
    expect(screen.queryByText("Java House")).not.toBeInTheDocument();
  });

  it("matches an action through its hidden keywords", () => {
    setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "play" } });

    expect(optionLabels()).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Start simulation/ })).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "zzzzzz" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});

describe("CommandPalette keyboard navigation", () => {
  it("moves the highlight with the arrow keys and wraps", () => {
    setup();
    const input = openPalette();

    expect(highlighted()).toHaveTextContent("Start simulation");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted()).toHaveTextContent("Open Monitor panel");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(highlighted()).toHaveTextContent("Start simulation");

    // Wraps backwards past the first row.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(highlighted()).toHaveTextContent("Open Monitor panel");
  });

  it("points aria-activedescendant at the highlighted row", () => {
    setup();
    const input = openPalette();

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input).toHaveAttribute("aria-activedescendant", highlighted()?.id);
  });

  it("runs the highlighted action on Enter and closes", () => {
    const { onStart, onMonitor } = setup();
    const input = openPalette();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMonitor).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects a vehicle with the app's own selection handler", () => {
    const { onSelectVehicle, onSelectItem } = setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "sim" } });
    // Rows: Start simulation, Sim Van, Simba Road, Simmers Place
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectVehicle).toHaveBeenCalledWith("v1");
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("selects a road / place with the SearchBar's selection handler", () => {
    const { onSelectItem } = setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "sim" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectItem).toHaveBeenCalledWith(roads[0]);
  });

  it("jumps to the last and first rows with End / Home", () => {
    setup();
    const input = openPalette();

    fireEvent.keyDown(input, { key: "End" });
    expect(highlighted()).toHaveTextContent("Open Monitor panel");

    fireEvent.keyDown(input, { key: "Home" });
    expect(highlighted()).toHaveTextContent("Start simulation");
  });

  it("is fully operable without a mouse: open, type, navigate, run", () => {
    const { onMonitor } = setup();
    const input = openPalette();

    fireEvent.change(input, { target: { value: "monitor" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMonitor).toHaveBeenCalledTimes(1);
  });
});

describe("CommandPalette Escape scoping", () => {
  it("closes on Escape", () => {
    setup();
    const input = openPalette();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("owns Escape only while open — other modes keep it when closed", () => {
    const otherMode = vi.fn();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") otherMode();
    };
    // Stand-in for useDispatchShortcuts / GeofenceDrawTool, which both listen
    // for Escape on `window` in the bubble phase.
    window.addEventListener("keydown", listener);

    try {
      setup();

      // Closed: the palette must not be in the way at all.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(otherMode).toHaveBeenCalledTimes(1);

      // Open: the palette is the topmost modal and consumes the press.
      const input = openPalette();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(otherMode).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Closed again: Escape flows straight through once more.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(otherMode).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("does not leave a document keydown listener behind once closed", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    setup();
    const input = openPalette();
    fireEvent.keyDown(input, { key: "Escape" });

    const isPaletteListener = (call: unknown[]) => call[0] === "keydown" && call[2] === true;
    const added = addSpy.mock.calls.filter(isPaletteListener);
    const removed = removeSpy.mock.calls.filter(isPaletteListener);

    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(added[0][1]);
  });

  it("unmounts cleanly, dropping the ⌘K listener", () => {
    const { unmount } = setup();
    unmount();

    pressChord();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

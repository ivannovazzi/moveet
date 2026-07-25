import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Panel switching used to go through the DOM: the palette looked the dock's
 * cluster buttons up by aria-label and clicked them (`dockControls.ts`).
 * `useDockNavigation` is lifted to `App` and handed to both surfaces now, so
 * these pin the same guarantees against the shared contract — one activation
 * lands on the target panel, and the dock's own button still closes what the
 * palette opened.
 *
 * The real `Dock` is rendered, so this fails if the palette and the dock ever
 * stop agreeing about which panel is open.
 */

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return {
    default: {
      ...createMockClient(),
      getClock: vi.fn().mockResolvedValue({ data: undefined }),
      setClock: vi.fn().mockResolvedValue({ data: undefined }),
    },
  };
});

vi.mock("@/Controls/Adapter/adapterClient", () => ({
  getHealth: vi.fn(() => Promise.reject(new Error("offline"))),
  getConfig: vi.fn(() => Promise.reject(new Error("offline"))),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  setRealism: vi.fn(),
}));

// Imported after the mocks so the hoisted factories are in place.
import Dock, { type DockProps } from "@/Dock/Dock";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { createModifiers, createStartOptions, createStatus } from "@/test/mocks/types";
import CommandPalette from "./CommandPalette";
import { buildCommands, type CommandDeps } from "./commands";

/** Everything `buildCommands` needs that isn't panel navigation. */
function otherDeps(): Omit<CommandDeps, "dock"> {
  return {
    running: false,
    options: createStartOptions(),
    isRecording: false,
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    replayStatus: { mode: "live" },
    onPauseReplay: vi.fn(),
    onResumeReplay: vi.fn(),
    onStopReplay: vi.fn(),
    onSetReplaySpeed: vi.fn(),
    dispatchMode: false,
    dispatchState: DispatchState.BROWSE,
    assignmentCount: 0,
    hasFailedDispatches: false,
    onToggleDispatchMode: vi.fn(),
    onExitDispatchMode: vi.fn(),
    onDispatch: vi.fn(),
    onRetryFailedDispatches: vi.fn(),
    onCreateRandomIncident: vi.fn(),
    onStartGeofenceDrawing: vi.fn(),
    heatzones: { isDrawing: false, toggleDraw: vi.fn(), seed: vi.fn(), clearAll: vi.fn() },
    modifiers: createModifiers(),
    onChangeModifiers: () => vi.fn(),
    onClearSelection: vi.fn(),
  };
}

function dockProps(): Omit<DockProps, "nav"> {
  return {
    connected: true,
    status: createStatus({ running: true }),
    isRecording: false,
    onStartRecording: async () => {},
    onStopRecording: async () => {},
    replayStatus: { mode: "live" },
    onPauseReplay: async () => {},
    onResumeReplay: async () => {},
    onStopReplay: async () => {},
    onSeekReplay: async () => {},
    onSetReplaySpeed: async () => {},
    vehicles: [],
    filter: "",
    onFilterChange: () => {},
    onSelectVehicle: () => {},
    onHoverVehicle: () => {},
    onUnhoverVehicle: () => {},
    maxSpeed: 60,
    vehicleFleetMap: new Map(),
    fleets: [],
    onCreateFleet: async () => {},
    onDeleteFleet: async () => {},
    onAssignVehicle: async () => {},
    onUnassignVehicle: async () => {},
    fleetsError: null,
    dispatch: {
      dispatchState: DispatchState.BROWSE,
      selectedForDispatch: [],
      assignments: [],
      results: [],
    } as unknown as DispatchFlow,
    incidents: { incidents: [], createRandom: async () => {}, remove: async () => {}, error: null },
    geofences: {
      fences: [],
      onFenceToggle: () => {},
      onFenceDelete: () => {},
      alerts: [],
      drawingActive: false,
      vertexCount: 0,
      onStartDrawing: () => {},
      onCancelDrawing: () => {},
      onConfirmDrawing: () => {},
    },
    analytics: { summary: null, fleetHistory: new Map(), summaryHistory: [] },
    toggles: { modifiers: createModifiers(), onChangeModifiers: () => () => {} },
    recordings: {
      recordings: [],
      replayStatus: { mode: "live" },
      onStartReplay: async () => {},
      onRefreshRecordings: () => {},
    },
    advanced: { maxSpeedRef: { current: 60 } },
  };
}

/** Stands in for `App`: one `useDockNavigation`, shared by the dock and the palette. */
function Harness() {
  const nav = useDockNavigation();
  return (
    <>
      <Dock nav={nav} {...dockProps()} />
      <CommandPalette
        vehicles={[]}
        roads={[]}
        pois={[]}
        actions={buildCommands({ dock: nav, ...otherDeps() })}
        onSelectVehicle={vi.fn()}
        onSelectItem={vi.fn()}
      />
    </>
  );
}

/** Open the palette, type the action's full label, and run it. */
function runPaletteAction(label: string) {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: label } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const cluster = (name: string) => screen.getByRole("button", { name });
/**
 * The dock's single panel surface stays mounted while closed, marked
 * `aria-hidden`; role queries skip hidden nodes, so this is exactly the set of
 * *visible* panels.
 */
const openPanels = () => screen.queryAllByRole("region").map((r) => r.getAttribute("aria-label"));

describe("command palette → dock panels", () => {
  it("lands on the target panel in one activation", async () => {
    render(<Harness />);
    expect(openPanels()).toEqual([]);

    runPaletteAction("Open Monitor panel");

    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(cluster("Monitor")).toHaveAttribute("aria-pressed", "true");
  });

  it("opens each panel-owning cluster by name", async () => {
    render(<Harness />);

    for (const [label, panel] of [
      ["Open Tempo panel", "Tempo"],
      ["Open Fleet & Dispatch panel", "Fleet & Dispatch"],
      ["Open Sinks & Source panel", "Sinks & Source"],
      ["Open Monitor panel", "Monitor"],
      ["Open Settings panel", "Settings"],
    ] as const) {
      runPaletteAction(label);
      expect(await screen.findByRole("region", { name: panel })).toBeInTheDocument();
      expect(openPanels()).toEqual([panel]);
    }
  });

  it("is idempotent — opening the panel that is already open leaves it open", async () => {
    render(<Harness />);

    runPaletteAction("Open Monitor panel");
    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();

    runPaletteAction("Open Monitor panel");

    expect(screen.getByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(cluster("Monitor")).toHaveAttribute("aria-pressed", "true");
  });

  it("closes whichever panel is open", async () => {
    render(<Harness />);

    runPaletteAction("Open Settings panel");
    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();

    runPaletteAction("Close dock panel");

    await waitFor(() => expect(openPanels()).toEqual([]));
    expect(cluster("Settings")).toHaveAttribute("aria-pressed", "false");
  });

  it("shares state with the dock's buttons: the active cluster still closes it", async () => {
    render(<Harness />);

    runPaletteAction("Open Monitor panel");
    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();

    // Clicking the cluster the palette activated toggles it shut — the two are
    // the same state, not two copies of it.
    fireEvent.click(cluster("Monitor"));

    await waitFor(() => expect(openPanels()).toEqual([]));
    expect(cluster("Monitor")).toHaveAttribute("aria-pressed", "false");
  });

  it("switches panels without reading the dock's markup", async () => {
    const querySelector = vi.spyOn(document, "querySelector");
    render(<Harness />);
    querySelector.mockClear();

    runPaletteAction("Open Fleet & Dispatch panel");

    expect(await screen.findByRole("region", { name: "Fleet & Dispatch" })).toBeInTheDocument();
    // The old bridge found the dock's cluster buttons with
    // `document.querySelector('button[aria-label="…"]')`.
    const lookups = querySelector.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("aria-label")
    );
    expect(lookups).toEqual([]);
    querySelector.mockRestore();
  });
});

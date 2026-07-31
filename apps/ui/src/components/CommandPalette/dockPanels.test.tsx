import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
      // The Session panel mounts RecordReplay, which polls generation state and
      // subscribes to its progress channels.
      getGenerateStatus: vi.fn().mockResolvedValue({ data: undefined }),
      onGenerateProgress: vi.fn(),
      offGenerateProgress: vi.fn(),
      onGenerateComplete: vi.fn(),
      offGenerateComplete: vi.fn(),
      onGenerateError: vi.fn(),
      offGenerateError: vi.fn(),
      // …and Scenarios polls its own catalogue.
      getScenarios: vi.fn().mockResolvedValue({ data: [] }),
      getScenarioStatus: vi.fn().mockResolvedValue({ data: undefined }),
      onScenarioEvent: vi.fn(),
      offScenarioEvent: vi.fn(),
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
import Dock from "@/Dock/Dock";
import { DispatchState } from "@/hooks/useDispatchState";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { createDockProps } from "@/test/dockProps";
import { createModifiers, createStartOptions } from "@/test/mocks/types";
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
    modeDescriptor: null,
    onStartMode: vi.fn(),
    dispatchState: DispatchState.BROWSE,
    assignmentCount: 0,
    hasFailedDispatches: false,
    onDispatch: vi.fn(),
    onRetryFailedDispatches: vi.fn(),
    faultsArmed: false,
    onToggleFaults: vi.fn(),
    onClearFaultState: vi.fn(),
    onCreateRandomIncident: vi.fn(),
    heatzones: { seed: vi.fn(), clearAll: vi.fn() },
    modifiers: createModifiers(),
    onChangeModifiers: () => vi.fn(),
    onClearSelection: vi.fn(),
  };
}

/** Stands in for `App`: one `useDockNavigation`, shared by the dock and the palette. */
function Harness() {
  const nav = useDockNavigation();
  return (
    <>
      <Dock navigation={nav} {...createDockProps()} />
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
  // Scoped to the palette: an open panel can hold comboboxes of its own (the
  // fleet assignment picker, for one).
  const input = within(screen.getByRole("dialog")).getByRole("combobox");
  fireEvent.change(input, { target: { value: label } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const cluster = (name: string) => screen.getByRole("button", { name });
/** The section key carries `aria-expanded` whether or not it is open. */
const sectionButton = (name: string) => cluster(name);
/**
 * Panel surfaces stay mounted while closed, marked `aria-hidden`; role queries
 * skip hidden nodes, so this is exactly the set of *visible* panels.
 */
const openPanels = () => screen.queryAllByRole("region").map((r) => r.getAttribute("aria-label"));

describe("command palette → dock panels", () => {
  it("lands on the target panel in one activation", async () => {
    render(<Harness />);
    expect(openPanels()).toEqual([]);

    runPaletteAction("Open Monitor › Incidents");

    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(sectionButton("Monitor")).toHaveAttribute("aria-expanded", "true");
  });

  it("opens every section button by name, tabs included", async () => {
    render(<Harness />);

    for (const [label, panel] of [
      ["Open Tempo panel", "Tempo"],
      ["Open Fleet › Groups", "Fleet"],
      ["Open Monitor › Faults", "Monitor"],
      ["Open Session › Scenarios", "Session"],
      ["Open Settings › Advanced", "Settings"],
    ] as const) {
      runPaletteAction(label);
      expect(await screen.findByRole("region", { name: panel })).toBeInTheDocument();
      expect(openPanels()).toEqual([panel]);
    }
  });

  it("lands on the requested tab, not just the section", async () => {
    render(<Harness />);

    runPaletteAction("Open Monitor › Geofences");

    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Geofences/ })).toHaveAttribute("aria-selected", "true");
  });

  it("is idempotent — opening the panel that is already open leaves it open", async () => {
    render(<Harness />);

    runPaletteAction("Open Monitor › Incidents");
    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();

    runPaletteAction("Open Monitor › Incidents");

    expect(screen.getByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(sectionButton("Monitor")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes whichever panel is open", async () => {
    render(<Harness />);

    runPaletteAction("Open Settings › Visibility");
    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();

    runPaletteAction("Collapse dock section");

    await waitFor(() => expect(openPanels()).toEqual([]));
    expect(sectionButton("Settings")).toHaveAttribute("aria-expanded", "false");
  });

  it("shares state with the dock's buttons: collapsing the section closes it", async () => {
    render(<Harness />);

    runPaletteAction("Open Monitor › Incidents");
    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();

    // Collapsing the section the palette expanded closes its panel — the two
    // are the same state, not two copies of it.
    fireEvent.click(cluster("Collapse Monitor"));

    await waitFor(() => expect(openPanels()).toEqual([]));
    expect(sectionButton("Monitor")).toHaveAttribute("aria-expanded", "false");
  });

  it("switches panels without reading the dock's markup", async () => {
    const querySelector = vi.spyOn(document, "querySelector");
    render(<Harness />);
    querySelector.mockClear();

    runPaletteAction("Open Fleet › List");

    expect(await screen.findByRole("region", { name: "Fleet" })).toBeInTheDocument();
    // The old bridge found the dock's cluster buttons with
    // `document.querySelector('button[aria-label="…"]')`.
    const lookups = querySelector.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("aria-label")
    );
    expect(lookups).toEqual([]);
    querySelector.mockRestore();
  });
});

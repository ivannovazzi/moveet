import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigResponse, HealthResponse } from "./adapterClient";

/**
 * Regression cover for fleetsim-all-8lcy ("Adapter sheet close race clobbers
 * next panel selection").
 *
 * The original bug lived in the pre-dock nav-rail: `AdapterDrawer` was a Radix
 * `Sheet` wired as `onClose={closePanel}`, so clicking a different nav item set
 * `activePanel` to the new panel and *then* the closing Sheet fired
 * `onOpenChange(false)` -> `closePanel()` -> `activePanel = null`. The click
 * looked like a no-op and had to be repeated.
 *
 * That drawer no longer exists — the adapter UI is now `SinksPanel` rendered
 * into the single shared `DockPanel`, and switching clusters is one
 * `setOpenCluster` call. These tests pin that behaviour so the race cannot be
 * reintroduced: a close handler must never run as a side effect of a panel
 * switch, while a genuine outside click / Escape must still close.
 */

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return {
    default: {
      ...createMockClient(),
      getClock: vi.fn().mockResolvedValue({ data: undefined }),
    },
  };
});

const health: HealthResponse = {
  source: { type: "simulator", healthy: true },
  sinks: [{ type: "kafka", healthy: true }],
  availableSources: [],
  availableSinks: [],
};

const config: ConfigResponse = {
  activeSource: "simulator",
  activeSinks: ["kafka"],
  sourceConfig: {},
  sinkConfig: {},
  status: health,
};

vi.mock("./adapterClient", () => ({
  getHealth: vi.fn(() => Promise.resolve(health)),
  getConfig: vi.fn(() => Promise.resolve(config)),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  setRealism: vi.fn(),
}));

// Imported after the mocks so the hoisted factories are in place.
import Dock, { type DockProps } from "@/Dock/Dock";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import { DispatchState } from "@/hooks/useDispatchState";
import { createStatus } from "@/test/mocks/types";
import type { Modifiers } from "@/types";

const modifiers: Modifiers = {
  showDirections: true,
  showHeatzones: false,
  showHeatmap: false,
  showVehicles: true,
  showPOIs: false,
  showTrafficOverlay: false,
  showBreadcrumbs: false,
  showSpeedLimits: false,
};

function dockProps(): DockProps {
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
    // Only `dispatchState` / `selectedForDispatch` are read by the dock bar
    // itself (the badge); the Fleet panel is never opened in these tests.
    dispatch: {
      dispatchState: DispatchState.BROWSE,
      selectedForDispatch: [],
    } as unknown as DispatchFlow,

    incidents: {
      incidents: [],
      createRandom: async () => {},
      remove: async () => {},
      error: null,
    },
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
    toggles: { modifiers, onChangeModifiers: () => () => {} },
    recordings: {
      recordings: [],
      replayStatus: { mode: "live" },
      onStartReplay: async () => {},
      onRefreshRecordings: () => {},
    },
    advanced: { maxSpeedRef: { current: 60 } },
  };
}

/** Open the adapter ("Sinks & Source") panel and wait for its content. */
async function openAdapterPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Sinks & Source" }));
  expect(await screen.findByRole("region", { name: "Sinks & Source" })).toBeInTheDocument();
}

describe("adapter panel <-> other panel switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches from the adapter panel to Monitor in a single click", async () => {
    const user = userEvent.setup();
    render(<Dock {...dockProps()} />);

    await openAdapterPanel(user);
    expect(screen.getByRole("button", { name: "Sinks & Source" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // One click on a different cluster must land on that cluster. The bug was
    // that the adapter drawer's own close handler fired afterwards and reset
    // the selection back to "nothing open".
    await user.click(screen.getByRole("button", { name: "Monitor" }));

    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monitor" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sinks & Source" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.queryByRole("region", { name: "Sinks & Source" })).not.toBeInTheDocument();

    // Still open a tick later — a deferred close would show up here.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("region", { name: "Monitor" })).toBeInTheDocument();
  });

  it("switches from the adapter panel to Tempo details in a single click", async () => {
    const user = userEvent.setup();
    render(<Dock {...dockProps()} />);

    await openAdapterPanel(user);

    await user.click(screen.getByRole("button", { name: "Tempo details" }));

    expect(await screen.findByRole("region", { name: "Tempo" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sinks & Source" })).not.toBeInTheDocument();
  });

  it("switches back into the adapter panel from another panel in a single click", async () => {
    const user = userEvent.setup();
    render(<Dock {...dockProps()} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sinks & Source" }));

    expect(await screen.findByRole("region", { name: "Sinks & Source" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("still closes the adapter panel when its own cluster is clicked again", async () => {
    const user = userEvent.setup();
    render(<Dock {...dockProps()} />);

    await openAdapterPanel(user);
    await user.click(screen.getByRole("button", { name: "Sinks & Source" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sinks & Source" })).not.toBeInTheDocument()
    );
  });

  it("still closes the adapter panel on a genuine outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <Dock {...dockProps()} />
      </div>
    );

    await openAdapterPanel(user);
    await user.click(screen.getByRole("button", { name: "outside" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sinks & Source" })).not.toBeInTheDocument()
    );
  });
});

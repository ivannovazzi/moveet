import { vi } from "vitest";
import type { DockProps } from "@/Dock/Dock";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { JobsPanelProps } from "@/Controls/JobsPanel";
import { DispatchState } from "@/hooks/useDispatchState";
import type { ModeGuard } from "@/hooks/useModeGuard";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { createModifiers, createStartOptions, createStatus } from "./mocks/types";

/** Adapter state as the dock sees it: lifted to App, one poller for two readers. */
export function createAdapterState(
  overrides: Partial<ReturnType<typeof useAdapterConfig>> = {}
): ReturnType<typeof useAdapterConfig> {
  return {
    health: null,
    config: null,
    loading: false,
    error: null,
    fetchHealth: async () => {},
    fetchConfig: async () => {},
    setSource: async () => {},
    addSink: async () => {},
    removeSink: async () => {},
    setRealism: async () => {},
    ...overrides,
  } as ReturnType<typeof useAdapterConfig>;
}

/** A mode guard that lets everything through — the default for dock tests. */
export function passthroughGuard(): ModeGuard {
  return {
    pending: null,
    request: (action: () => void) => action(),
    confirm: () => {},
    dismiss: () => {},
  };
}

/**
 * Props for rendering the real `Dock` in a test, minus `navigation` (supplied
 * by a harness calling `useDockNavigation`, the way `App` does). Shared by the
 * panel-switching suites so a new dock prop lands in one place.
 */
export function createDockProps(
  overrides: Partial<Omit<DockProps, "navigation">> = {}
): Omit<DockProps, "navigation"> {
  return {
    adapter: createAdapterState(),
    connected: true,
    status: createStatus({ running: true }),
    options: createStartOptions(),
    isRecording: false,
    onStartRecording: async () => {},
    onStopRecording: async () => {},

    modeDescriptor: null,
    guard: passthroughGuard(),
    onStartMode: vi.fn(),
    onEnterDispatch: vi.fn(),

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
    // itself (the Fleet badge); suites that open the Fleet panel pass more.
    dispatch: {
      dispatchState: DispatchState.BROWSE,
      selectedForDispatch: [],
      assignments: [],
      results: [],
      error: null,
    } as unknown as DispatchFlow,
    jobs: {
      jobs: [],
      counts: { total: 0, live: 0, queued: 0, breached: 0 },
      draft: { active: false } as unknown as JobsPanelProps["draft"],
      onCancelJob: async () => {},
      onDeleteJob: async () => {},
      onAssignJob: async () => {},
      vehicles: [],
      jobByVehicleId: new Map(),
      error: null,
    },

    incidents: { incidents: [], createRandom: async () => {}, remove: async () => {}, error: null },
    faults: {
      faults: {
        config: null,
        status: null,
        loading: false,
        error: null,
        configure: async () => {},
        setVehicleProfile: async () => {},
        clearVehicleProfile: async () => {},
        reset: async () => {},
      },
      vehicles: [],
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
    toggles: { modifiers: createModifiers(), onChangeModifiers: () => () => {} },
    recordings: {
      recordings: [],
      replayStatus: { mode: "live" },
      onStartReplay: async () => {},
      onRefreshRecordings: () => {},
    },
    advanced: { maxSpeedRef: { current: 60 } },
    ...overrides,
  };
}

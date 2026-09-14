import { vi } from "vitest";
import { render } from "@testing-library/react";
import Dock, { type DockProps } from "@/Dock/Dock";
import ConsoleSections, { type ConsoleSectionsProps } from "@/shell/Console/ConsoleSections";
import { buildDockBadges } from "@/Dock/dockBadges";
import { useDockNavigation, type DockNavigation } from "@/hooks/useDockNavigation";
import type { DockTabId } from "@/Dock/dockSections";
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
 * The dock row and the console are two halves of one surface: the keys open a
 * section, the console shows it. Nothing that opens a panel can be tested
 * against either half alone, so this is the prop set for both, minus the three
 * things `App` derives (`navigation`, `badges`, `onSelectTab`).
 */
export type DockShellProps = Omit<DockProps, "navigation" | "badges"> &
  Omit<ConsoleSectionsProps, "navigation" | "badges" | "onSelectTab">;

export function createDockProps(overrides: Partial<DockShellProps> = {}): DockShellProps {
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
    // Nothing selected: the Inspect view's empty state, which is the state it
    // is in for most of a run.
    inspector: {},
    ...overrides,
  };
}

/**
 * Render the dock row and its console together, wired the way `App` wires them:
 * one `useDockNavigation`, one set of badges, and a tab handler both halves go
 * through. Suites that press a section key and then assert on what opened need
 * both halves on screen, and a harness is the only place that pairing should be
 * spelled out.
 */
export function DockShell({
  props,
  navigation: external,
  onSelectTab,
}: {
  props: DockShellProps;
  /**
   * Share navigation with something else on screen (the command palette drives
   * the very same state). Omitted, the harness owns it, as `App` does.
   */
  navigation?: DockNavigation;
  /** Override the tab handler — `App` wraps it for Fleet's Dispatch tab. */
  onSelectTab?: (tab: DockTabId) => void;
}) {
  const own = useDockNavigation();
  const navigation = external ?? own;
  const badges = buildDockBadges({
    dispatch: props.dispatch,
    breachedJobs: props.jobs.counts.breached,
    openIncidents: props.incidents.incidents.length,
    faults: props.faults.faults,
    isRecording: props.isRecording,
  });
  return (
    <>
      <Dock {...props} navigation={navigation} badges={badges} />
      <ConsoleSections
        {...props}
        navigation={navigation}
        badges={badges}
        onSelectTab={onSelectTab ?? navigation.selectTab}
      />
    </>
  );
}

/** `DockShell` with the default prop set, for the common case. */
export function renderDockShell(
  overrides: Partial<DockShellProps> = {},
  onSelectTab?: (tab: DockTabId) => void
) {
  return render(<DockShell props={createDockProps(overrides)} onSelectTab={onSelectTab} />);
}

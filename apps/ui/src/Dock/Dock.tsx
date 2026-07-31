import { useCallback, useEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, ReplayStatus, SimulationStatus, StartOptions, Vehicle } from "@/types";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import type { ModeGuard } from "@/hooks/useModeGuard";
import { useClock } from "@/hooks/useClock";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { DispatchState } from "@/hooks/useDispatchState";
import AnchoredPanel from "./AnchoredPanel";
import DockSurface from "./DockSurface";
import DockCenter from "./DockCenter";
import DockStateRail from "./DockStateRail";
import TransportCluster from "./TransportCluster";
import TempoInline from "./TempoInline";
import TempoPanel from "./TempoPanel";
import SectionRail from "./SectionRail";
import ActionDock from "./ActionDock";
import FleetPanel from "./FleetPanel";
import MonitorPanel from "./MonitorPanel";
import SessionPanel from "./SessionPanel";
import SettingsPanel from "./SettingsPanel";
import { countMisbehavingDevices } from "@/lib/faultPresets";
import { useRowOffset } from "./dockRowLayout";
import type {
  DockBadges,
  DockSection,
  DockTabId,
  FleetTabId,
  MonitorTabId,
  SessionTabId,
  SettingsTabId,
} from "./dockSections";
import type { ModeDescriptor } from "./modeDescriptors";
import type Incidents from "@/Controls/Incidents";
import type GeofencePanel from "@/Controls/GeofencePanel";
import type AnalyticsPanel from "@/Controls/AnalyticsPanel";
import type TogglesPanel from "@/Controls/TogglesPanel";
import type RecordReplay from "@/Controls/RecordReplay";
import type AdvancedTuningTab from "./AdvancedTuningTab";

/* ── The dock row: the main dock plus the section surfaces beside it ── */
const ROW_CLASS = cn(
  "absolute bottom-5 left-1/2 z-50 flex items-stretch gap-2 translate-y-3.5",
  "pointer-events-none opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

const Divider = () => <div className="mx-0.5 my-2 w-px self-stretch bg-border-soft" />;

export interface DockProps {
  /**
   * Which section is expanded into its own dock and which of its buttons is
   * lit. Owned by `App.tsx` so the command palette drives the very same state
   * and the keyboard dispatcher can collapse the row on Escape.
   */
  navigation: DockNavigation;

  /**
   * Lifted `useAdapterConfig` result. App owns it because the health lamps in
   * the corner read it too, and one poller is enough.
   */
  adapter: ReturnType<typeof useAdapterConfig>;

  connected: boolean;
  status: SimulationStatus;
  options: StartOptions;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /**
   * The active map mode as words, tone and actions (null while browsing), plus
   * the guard that holds a mode switch when the current one is carrying work.
   */
  modeDescriptor: ModeDescriptor | null;
  guard: ModeGuard;
  onStartMode: (kind: InteractionModeKind) => void;
  /** Enters dispatch through the guard (the Fleet dock's Dispatch button). */
  onEnterDispatch: () => void;
  /** Leaves dispatch mode (selecting another Fleet button). */
  onExitDispatch: () => void;

  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  // Fleet
  vehicles: Vehicle[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedId?: string;
  onSelectVehicle: (id: string) => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  maxSpeed: number;
  vehicleFleetMap: Map<string, Fleet>;
  fleets: Fleet[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  fleetsError?: string | null;
  dispatch: DispatchFlow;
  jobs: ComponentProps<typeof FleetPanel>["jobs"];

  // Monitor
  incidents: ComponentProps<typeof Incidents>;
  faults: ComponentProps<typeof MonitorPanel>["faults"];
  geofences: ComponentProps<typeof GeofencePanel>;
  analytics: ComponentProps<typeof AnalyticsPanel>;

  // Session / Settings
  toggles: ComponentProps<typeof TogglesPanel>;
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;

  className?: string;
}

/**
 * The dock row.
 *
 *   action    — its own surface: the four ways to start new work on the map
 *   main dock — transport and tempo, plus a context slot that opens only when
 *               there is something to say (an active mode, a replay, a pending
 *               discard). Idle, the dock is just time controls.
 *   sections  — Fleet / Monitor / Session / Settings keys; selecting one unfolds
 *               that section's own buttons beside it and opens its panel above.
 *
 * The row is laid out from the viewport's centre line so the *main dock* stays
 * put: a section unfolding grows the row to the right instead of sliding the
 * transport controls sideways (see `dockRowLayout`). Health lamps are not here
 * at all — they live in the top-right corner, where nothing is pressed.
 *
 * Owns the shared `useClock` so the tempo readout and its panel cannot disagree.
 * Adapter state arrives from App, which shares it with the corner health lamps.
 */
export default function Dock({
  navigation,
  adapter,
  connected,
  status,
  options,
  isRecording,
  onStartRecording,
  onStopRecording,
  modeDescriptor,
  guard,
  onStartMode,
  onEnterDispatch,
  onExitDispatch,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onSetReplaySpeed,
  vehicles,
  filter,
  onFilterChange,
  selectedId,
  onSelectVehicle,
  onHoverVehicle,
  onUnhoverVehicle,
  maxSpeed,
  vehicleFleetMap,
  fleets,
  onCreateFleet,
  onDeleteFleet,
  onAssignVehicle,
  onUnassignVehicle,
  fleetsError,
  dispatch,
  jobs,
  incidents,
  faults,
  geofences,
  analytics,
  toggles,
  recordings,
  advanced,
  className,
}: DockProps) {
  const { expanded, tab, tempoOpen, toggleTempo, selectTab, close } = navigation;
  const { clock, setSpeedMultiplier } = useClock();
  const faultyDevices = countMisbehavingDevices(faults.faults.config, faults.faults.status);

  const rowRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const tempoBtnRef = useRef<HTMLButtonElement>(null);
  const rowShift = useRowOffset(rowRef, mainRef, expanded !== null);

  const replaying = replayStatus.mode === "replay";
  const dispatchCount =
    dispatch.dispatchState !== DispatchState.BROWSE ? dispatch.selectedForDispatch.length : 0;

  // Counts ride on fixed buttons rather than adding or removing them, so the
  // shape of an expanded section never depends on live data.
  const badges: DockBadges = {
    dispatch:
      dispatchCount > 0
        ? {
            count: dispatchCount,
            tone: "accent",
            label: `${dispatchCount} vehicles selected for dispatch`,
          }
        : undefined,
    jobs:
      jobs.counts.breached > 0
        ? {
            count: jobs.counts.breached,
            tone: "error",
            label: `${jobs.counts.breached} jobs past SLA`,
          }
        : undefined,
    incidents:
      incidents.incidents.length > 0
        ? {
            count: incidents.incidents.length,
            tone: "error",
            label: `${incidents.incidents.length} open incidents`,
          }
        : undefined,
    faults:
      faultyDevices > 0
        ? { count: faultyDevices, tone: "error", label: `${faultyDevices} misbehaving devices` }
        : undefined,
    recordings: isRecording
      ? { count: 1, tone: "error", label: "Recording in progress" }
      : undefined,
  };

  // Selecting a Fleet button is also a mode decision: Dispatch enters dispatch
  // mode (through the guard), and stepping off it leaves. A half-placed job is
  // deliberately NOT cancelled by leaving the Jobs button any more — the mode
  // rail reports it and owns Escape, so it can no longer become invisible.
  const handleSelectTab = useCallback(
    (next: DockTabId) => {
      if (expanded === "fleet") {
        if (next === "dispatch") {
          onEnterDispatch();
          return;
        }
        if (dispatch.dispatchMode) onExitDispatch();
      }
      selectTab(next);
    },
    [expanded, dispatch.dispatchMode, onEnterDispatch, onExitDispatch, selectTab]
  );

  // Dispatch started elsewhere (the launcher, D, the palette): light the button
  // that owns it so the dock never contradicts the mode rail.
  useEffect(() => {
    if (dispatch.dispatchMode && expanded === "fleet" && tab !== "dispatch") selectTab("dispatch");
  }, [dispatch.dispatchMode, expanded, tab, selectTab]);

  const renderPanel = useCallback(
    (section: DockSection) => {
      if (!tab) return null;
      switch (section.id) {
        case "fleet":
          return (
            <FleetPanel
              tab={tab as FleetTabId}
              vehicles={vehicles}
              filter={filter}
              onFilterChange={onFilterChange}
              selectedId={selectedId}
              onSelectVehicle={onSelectVehicle}
              onHoverVehicle={onHoverVehicle}
              onUnhoverVehicle={onUnhoverVehicle}
              maxSpeed={maxSpeed}
              vehicleFleetMap={vehicleFleetMap}
              fleets={fleets}
              onCreateFleet={onCreateFleet}
              onDeleteFleet={onDeleteFleet}
              onAssignVehicle={onAssignVehicle}
              onUnassignVehicle={onUnassignVehicle}
              fleetsError={fleetsError}
              dispatch={dispatch}
              jobs={jobs}
            />
          );
        case "monitor":
          return (
            <MonitorPanel
              tab={tab as MonitorTabId}
              incidents={incidents}
              analytics={analytics}
              geofences={geofences}
              faults={faults}
            />
          );
        case "session":
          return <SessionPanel tab={tab as SessionTabId} recordings={recordings} />;
        case "settings":
          return (
            <SettingsPanel
              tab={tab as SettingsTabId}
              toggles={toggles}
              advanced={advanced}
              feeds={{ adapter }}
            />
          );
      }
    },
    [
      tab,
      vehicles,
      filter,
      onFilterChange,
      selectedId,
      onSelectVehicle,
      onHoverVehicle,
      onUnhoverVehicle,
      maxSpeed,
      vehicleFleetMap,
      fleets,
      onCreateFleet,
      onDeleteFleet,
      onAssignVehicle,
      onUnassignVehicle,
      fleetsError,
      dispatch,
      jobs,
      incidents,
      analytics,
      geofences,
      faults,
      recordings,
      toggles,
      advanced,
      adapter,
    ]
  );

  return (
    <div ref={rowRef} className={cn(ROW_CLASS, className)} style={{ marginLeft: rowShift }}>
      {/* Starting new work has its own surface at the head of the row. */}
      <ActionDock
        onStartMode={onStartMode}
        busy={modeDescriptor !== null || replaying}
        offline={!connected}
      />

      <DockSurface ref={mainRef} className="relative">
        <TransportCluster
          running={status.running}
          options={options}
          isRecording={isRecording}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
          guardRequest={guard.request}
          disabled={!connected}
        />

        {/* Tempo sits with the transport: play, reset, record and speed are all
            controls over the run's clock. */}
        <Divider />
        <TempoInline
          clock={clock}
          detailsOpen={tempoOpen}
          onToggleDetails={toggleTempo}
          buttonRef={tempoBtnRef}
          disabled={replaying}
        />

        <DockCenter
          descriptor={modeDescriptor}
          guard={guard}
          replayStatus={replayStatus}
          onPauseReplay={onPauseReplay}
          onResumeReplay={onResumeReplay}
          onStopReplay={onStopReplay}
          onSeekReplay={onSeekReplay}
          onSetReplaySpeed={onSetReplaySpeed}
        />

        <DockStateRail
          tone={modeDescriptor?.tone ?? null}
          recording={isRecording}
          replayProgress={
            replaying && replayStatus.duration
              ? (replayStatus.currentTime ?? 0) / replayStatus.duration
              : null
          }
        />

        <AnchoredPanel
          open={tempoOpen}
          id="dock-tempo-panel"
          aria-label="Tempo"
          eyebrow="Tempo"
          anchorRef={tempoBtnRef}
          originRef={mainRef}
          width="w-[340px]"
          positionKey="tempo"
          onClose={close}
        >
          <TempoPanel clock={clock} onSetMultiplier={setSpeedMultiplier} />
        </AnchoredPanel>
      </DockSurface>

      <SectionRail
        navigation={navigation}
        badges={badges}
        onSelectTab={handleSelectTab}
        renderPanel={renderPanel}
      />
    </div>
  );
}

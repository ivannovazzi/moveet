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
import DockDeck, { dockActivity } from "./DockDeck";
import TempoPanel from "./TempoPanel";
import SectionRail from "./SectionRail";
import FleetPanel from "./FleetPanel";
import MonitorPanel from "./MonitorPanel";
import SessionPanel from "./SessionPanel";
import SettingsPanel from "./SettingsPanel";
import { countMisbehavingDevices } from "@/lib/faultPresets";
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
import type RecordReplay from "@/Controls/RecordReplay";
import type AdvancedTuningTab from "./AdvancedTuningTab";

/**
 * The dock row: three columns pinned across the viewport, bottom aligned.
 *
 * `1fr auto 1fr` puts the deck's centre exactly on the viewport's centre line —
 * permanently, whatever else is on the row — and gives the sections wing its own
 * half to grow into. The wing can never push the deck, and can never grow past
 * its half: it wraps inside it instead of running off screen. The grid itself is
 * click-through; only the surfaces take pointer events (see `DockSurface`), so
 * the empty map either side of the docks still pans.
 */
const ROW_CLASS = cn(
  "pointer-events-none absolute inset-x-2 bottom-5 z-50 grid items-end gap-2",
  "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  "translate-y-3.5 opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

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
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;

  className?: string;
}

/**
 * The dock row: two docks, and one rule that holds them apart.
 *
 *   deck     — the centre, on the viewport's centre line. Its contents are the
 *              current activity's keys and nothing else: watching the run, in a
 *              mode, replaying, or being asked to discard (see `DockDeck`). It is
 *              as wide as that key set needs and no wider.
 *   sections — right wing: Fleet / Monitor / Session / Settings keys; selecting
 *              one unfolds that section's own buttons beside it and opens its
 *              panel above. Grows rightward inside its half.
 *
 * Health lamps are not here at all — they live in the top-right corner, where
 * nothing is pressed.
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
  recordings,
  advanced,
  className,
}: DockProps) {
  const { expanded, tab, tempoOpen, toggleTempo, selectTab, close } = navigation;
  const { clock, setSpeedMultiplier } = useClock();
  const faultyDevices = countMisbehavingDevices(faults.faults.config, faults.faults.status);

  // The deck is the tempo panel's positioning origin.
  const mainRef = useRef<HTMLDivElement>(null);
  const tempoBtnRef = useRef<HTMLButtonElement>(null);

  // Exposed on the surface as `data-activity` so what the dock is currently for
  // is inspectable from the DOM (and assertable in tests) without reading classes.
  const deckActivity = dockActivity({
    pendingDiscard: guard.pending !== null,
    replaying: replayStatus.mode === "replay",
    inMode: modeDescriptor !== null,
  });

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
            <SettingsPanel tab={tab as SettingsTabId} advanced={advanced} feeds={{ adapter }} />
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
      advanced,
      adapter,
    ]
  );

  return (
    <div className={cn(ROW_CLASS, className)}>
      {/* The left column is deliberately empty: it is what keeps the deck's
          centre on the viewport's centre line while the right wing grows. */}
      <div aria-hidden />

      {/* The tempo panel is a sibling of the bar rather than a child: a blurred
          ancestor is a backdrop root, and a panel inside one has nothing to
          frost (see `AnchoredPanel`). */}
      <div className="relative flex">
        <DockSurface
          ref={mainRef}
          data-dock="deck"
          data-activity={deckActivity}
          // Sized to the key set it is holding, and centred, so the bar is
          // exactly as wide as the work at hand: two keys while drawing a heat
          // zone, the run's five while watching it. What stays put is the dock's
          // centre — the eye finds it in the same place in every activity.
          className="relative items-center overflow-hidden"
        >
          <DockDeck
            connected={connected}
            running={status.running}
            options={options}
            isRecording={isRecording}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            clock={clock}
            tempoOpen={tempoOpen}
            onToggleTempo={toggleTempo}
            tempoButtonRef={tempoBtnRef}
            modeDescriptor={modeDescriptor}
            guard={guard}
            onStartMode={onStartMode}
            replayStatus={replayStatus}
            onPauseReplay={onPauseReplay}
            onResumeReplay={onResumeReplay}
            onStopReplay={onStopReplay}
            onSeekReplay={onSeekReplay}
            onSetReplaySpeed={onSetReplaySpeed}
          />
        </DockSurface>

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
      </div>

      {/* Right wing. Left-aligned, so the four section keys sit in the same
          place whether or not one of them is expanded. */}
      <div className="flex min-w-0 justify-start">
        <SectionRail
          navigation={navigation}
          badges={badges}
          onSelectTab={handleSelectTab}
          renderPanel={renderPanel}
        />
      </div>
    </div>
  );
}

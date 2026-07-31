import { useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, ReplayStatus, SimulationStatus, StartOptions, Vehicle } from "@/types";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import type { ModeGuard } from "@/hooks/useModeGuard";
import { useClock } from "@/hooks/useClock";
import { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { DispatchState } from "@/hooks/useDispatchState";
import { CarIcon, ChartIcon, GaugeIcon, RecordCircleIcon } from "@/components/Icons";
import DockCluster from "./DockCluster";
import DockPanel from "./DockPanel";
import DockCenter from "./DockCenter";
import DockStateRail from "./DockStateRail";
import TransportCluster from "./TransportCluster";
import TempoInline from "./TempoInline";
import StatusChips from "./StatusChips";
import FleetPanel from "./FleetPanel";
import TempoPanel from "./TempoPanel";
import MonitorPanel from "./MonitorPanel";
import SessionPanel from "./SessionPanel";
import SettingsPanel from "./SettingsPanel";
import { FEED_HEALTH_TONE, feedHealth } from "./FeedsSection";
import { countMisbehavingDevices } from "@/lib/faultPresets";
import type { ModeDescriptor } from "./modeDescriptors";
import type Incidents from "@/Controls/Incidents";
import type GeofencePanel from "@/Controls/GeofencePanel";
import type AnalyticsPanel from "@/Controls/AnalyticsPanel";
import type TogglesPanel from "@/Controls/TogglesPanel";
import type RecordReplay from "@/Controls/RecordReplay";
import type AdvancedTuningTab from "./AdvancedTuningTab";

/* ── Dock bar container (glass overlay floating over the map) ── */
const DOCK_CLASS = cn(
  "absolute bottom-5 left-1/2 z-50 flex h-[54px] max-w-[calc(100vw-1rem)] -translate-x-1/2 translate-y-3.5 items-stretch p-1.5",
  "rounded-[13px] border border-border surface-glass shadow-elevated backdrop-blur-xl",
  "pointer-events-none opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

const Divider = () => <div className="mx-0.5 my-2 w-px self-stretch bg-border-soft" />;

const PANEL_LABEL: Record<string, string> = {
  tempo: "Tempo",
  fleet: "Fleet",
  monitor: "Monitor",
  session: "Session",
  settings: "Settings",
};

export interface DockProps {
  /**
   * Which cluster's panel is open, and how to change it. Owned by `App.tsx` so
   * the command palette can open/close the very same panels by calling this
   * contract instead of clicking the dock's buttons through the DOM, and so the
   * app-level keyboard dispatcher can close the open panel on Escape (see
   * useInteractionKeyboard).
   */
  navigation: DockNavigation;

  connected: boolean;
  status: SimulationStatus;
  options: StartOptions;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /**
   * The active map mode as words, tone and actions (null while browsing), plus
   * the guard that holds a mode switch when the current one is carrying work.
   * Both are built in `App.tsx` from the same descriptor table the keyboard
   * dispatcher runs, so the bar and the keyboard can never disagree.
   */
  modeDescriptor: ModeDescriptor | null;
  guard: ModeGuard;
  onStartMode: (kind: InteractionModeKind) => void;
  /** Enters dispatch through the guard (Fleet panel's Dispatch segment). */
  onEnterDispatch: () => void;

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
 * Root dock: three zones and one morphing panel.
 *
 *   left   — time: transport (play/pause, reset, record) and tempo
 *   centre — context: the mode launcher, the active mode's rail, the replay
 *            transport, or a pending-discard question (see `DockCenter`)
 *   right  — places: the four panel clusters and the health chips
 *
 * Only the centre changes with what the operator is doing. The bar itself never
 * rearranges and never goes away: the previous dock swapped its whole self for
 * a replay bar, which took tempo, every panel and the status chips off screen
 * for the length of the playback.
 *
 * Owns the shared `useClock` and `useAdapterConfig` state so the inline tempo
 * scrubber / details panel stay in sync and feed health keeps polling for the
 * status chip while its Settings tab is closed. Panel navigation is *not* owned
 * here — it arrives as `navigation` from `App.tsx`, which shares it with the
 * command palette.
 */
export default function Dock({
  navigation,
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
  const { openCluster, panelOpen, toggle, close, isOpen } = navigation;
  const { clock, setSpeedMultiplier } = useClock();
  const adapter = useAdapterConfig(openCluster === "settings");
  const faultyDevices = countMisbehavingDevices(faults.faults.config, faults.faults.status);
  const dockRef = useRef<HTMLDivElement>(null);

  const replaying = replayStatus.mode === "replay";
  const dispatchCount =
    dispatch.dispatchState !== DispatchState.BROWSE ? dispatch.selectedForDispatch.length : 0;
  const incidentCount = incidents.incidents.length;
  const health = feedHealth(adapter.health);

  const countBadge = (count: number, tone: "accent" | "err") =>
    count > 0 ? (
      <span
        className={cn(
          "flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] border-glass-bot px-[3px]",
          "font-mono text-[9px] font-bold leading-none text-white tabular-nums",
          tone === "accent" ? "bg-accent" : "bg-status-error"
        )}
      >
        {count > 9 ? "9+" : count}
      </span>
    ) : undefined;

  // One badge slot, so the loudest thing wins — and always says what it counted,
  // since a bare red "2" reads identically for incidents and broken devices.
  const fleetBadge =
    jobs.counts.breached > 0
      ? {
          node: countBadge(jobs.counts.breached, "err"),
          label: `${jobs.counts.breached} jobs past SLA`,
        }
      : dispatchCount > 0
        ? {
            node: countBadge(dispatchCount, "accent"),
            label: `${dispatchCount} vehicles selected for dispatch`,
          }
        : null;
  const monitorBadge =
    incidentCount > 0
      ? { node: countBadge(incidentCount, "err"), label: `${incidentCount} open incidents` }
      : faultyDevices > 0
        ? { node: countBadge(faultyDevices, "err"), label: `${faultyDevices} misbehaving devices` }
        : null;

  return (
    <>
      <DockPanel
        open={panelOpen}
        onClose={close}
        dockRef={dockRef}
        contentKey={openCluster ?? "none"}
        aria-label={openCluster ? PANEL_LABEL[openCluster] : undefined}
      >
        {openCluster === "fleet" && (
          <FleetPanel
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
            onEnterDispatch={onEnterDispatch}
            jobs={jobs}
          />
        )}
        {openCluster === "tempo" && (
          <TempoPanel clock={clock} onSetMultiplier={setSpeedMultiplier} />
        )}
        {openCluster === "monitor" && (
          <MonitorPanel
            incidents={incidents}
            analytics={analytics}
            geofences={geofences}
            faults={faults}
          />
        )}
        {openCluster === "session" && <SessionPanel recordings={recordings} />}
        {openCluster === "settings" && (
          <SettingsPanel toggles={toggles} advanced={advanced} feeds={{ adapter }} />
        )}
      </DockPanel>

      <div ref={dockRef} className={cn(DOCK_CLASS, className)}>
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
        <div className="hidden items-stretch md:flex">
          <Divider />
          <TempoInline
            clock={clock}
            onSetMultiplier={setSpeedMultiplier}
            detailsOpen={isOpen("tempo")}
            onToggleDetails={() => toggle("tempo")}
            disabled={replaying}
          />
        </div>

        <Divider />

        <DockCenter
          descriptor={modeDescriptor}
          guard={guard}
          replayStatus={replayStatus}
          onPauseReplay={onPauseReplay}
          onResumeReplay={onResumeReplay}
          onStopReplay={onStopReplay}
          onSeekReplay={onSeekReplay}
          onSetReplaySpeed={onSetReplaySpeed}
          onStartMode={onStartMode}
          offline={!connected}
        />

        <Divider />

        <div className="flex items-center gap-1 px-1.5">
          <DockCluster
            icon={<CarIcon />}
            label="Fleet"
            active={isOpen("fleet")}
            badge={fleetBadge?.node}
            badgeLabel={fleetBadge?.label}
            aria-label="Fleet"
            onClick={() => toggle("fleet")}
          />
          <DockCluster
            icon={<ChartIcon />}
            label="Monitor"
            active={isOpen("monitor")}
            badge={monitorBadge?.node}
            badgeLabel={monitorBadge?.label}
            aria-label="Monitor"
            onClick={() => toggle("monitor")}
          />
          <DockCluster
            icon={<RecordCircleIcon />}
            label="Session"
            active={isOpen("session")}
            badge={
              isRecording ? (
                <span className="block size-2 rounded-full border-[1.5px] border-glass-bot bg-status-error motion-safe:animate-pulse" />
              ) : undefined
            }
            badgeLabel={isRecording ? "Recording in progress" : undefined}
            aria-label="Session"
            onClick={() => toggle("session")}
          />
          <DockCluster
            icon={<GaugeIcon />}
            label="Settings"
            active={isOpen("settings")}
            aria-label="Settings"
            onClick={() => toggle("settings")}
          />
        </div>

        {/* Status chips are the first thing to drop on a narrow viewport —
            they're glanceable, not interactive, so the dock stays usable. */}
        <div className="hidden items-stretch lg:flex">
          <Divider />
          <StatusChips
            chips={[
              {
                key: "ws",
                label: "WS",
                tone: connected ? "ok" : "idle",
                title: connected ? "Live socket connected" : "Live socket disconnected",
              },
              {
                key: "sim",
                label: "SIM",
                tone: status.running ? "ok" : "idle",
                title: status.running ? "Simulation running" : "Simulation paused",
              },
              {
                key: "feed",
                label: "FEED",
                tone: FEED_HEALTH_TONE[health],
                title: `Feeds & sinks: ${health.toLowerCase()}`,
              },
            ]}
          />
        </div>

        <DockStateRail
          tone={modeDescriptor?.tone ?? null}
          recording={isRecording}
          replayProgress={
            replaying && replayStatus.duration
              ? (replayStatus.currentTime ?? 0) / replayStatus.duration
              : null
          }
        />
      </div>
    </>
  );
}

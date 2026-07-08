import { useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { Fleet, ReplayStatus, SimulationStatus, Vehicle } from "@/types";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import { useDockNavigation, type DockClusterId } from "@/hooks/useDockNavigation";
import { useClock } from "@/hooks/useClock";
import { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import { DispatchState } from "@/hooks/useDispatchState";
import { CarIcon, Gear, ChartIcon } from "@/components/Icons";
import DockCluster from "./DockCluster";
import DockPanel from "./DockPanel";
import PlaybackCluster from "./PlaybackCluster";
import TempoInline from "./TempoInline";
import StatusChips from "./StatusChips";
import ReplayDock from "./ReplayDock";
import FleetPanel from "./FleetPanel";
import TempoPanel from "./TempoPanel";
import SinksPanel from "./SinksPanel";
import MonitorPanel from "./MonitorPanel";
import type { StatusTone } from "./DockPanelKit";
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

/** Cluster ids that own a panel (playback is one-click-only, no panel). */
const PANEL_CLUSTERS = new Set<DockClusterId>([
  "tempo",
  "fleet-dispatch",
  "sinks-source",
  "monitor",
]);

const PANEL_LABEL: Record<string, string> = {
  tempo: "Tempo",
  "fleet-dispatch": "Fleet & Dispatch",
  "sinks-source": "Sinks & Source",
  monitor: "Monitor",
};

export interface DockProps {
  connected: boolean;
  status: SimulationStatus;
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  // Fleet & Dispatch
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

  // Monitor
  incidents: ComponentProps<typeof Incidents>;
  geofences: ComponentProps<typeof GeofencePanel>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  toggles: ComponentProps<typeof TogglesPanel>;
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;

  className?: string;
}

/** Coarse, user-facing health tone for the Sinks cluster dot (same derivation
 * as the old adapter drawer's four-state readout, collapsed to a tone). */
function adapterTone(health: ReturnType<typeof useAdapterConfig>["health"]): StatusTone {
  if (!health) return "idle";
  if (!health.source && health.sinks.length === 0) return "idle";
  const healthy = health.source?.healthy !== false && health.sinks.every((s) => s.healthy);
  return healthy ? "ok" : "warn";
}

/**
 * Root dock: one persistent transport bar plus a single morphing panel that
 * opens in a fixed spot above it (see the approved mockup). Owns the shared
 * `useDockNavigation`, `useClock`, and `useAdapterConfig` state so the inline
 * tempo scrubber / details panel stay in sync and the adapter health dot keeps
 * polling while its panel is closed. Swaps to `ReplayDock` during replay.
 */
export default function Dock({
  connected,
  status,
  isRecording,
  onStartRecording,
  onStopRecording,
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
  incidents,
  geofences,
  analytics,
  toggles,
  recordings,
  advanced,
  className,
}: DockProps) {
  const { openCluster, toggle, close, isOpen } = useDockNavigation();
  const { clock, setSpeedMultiplier } = useClock();
  const adapter = useAdapterConfig(openCluster === "sinks-source");
  const dockRef = useRef<HTMLDivElement>(null);
  const tempoBtnRef = useRef<HTMLButtonElement>(null);

  if (replayStatus.mode === "replay") {
    return (
      <ReplayDock
        replayStatus={replayStatus}
        onPauseReplay={onPauseReplay}
        onResumeReplay={onResumeReplay}
        onStopReplay={onStopReplay}
        onSeekReplay={onSeekReplay}
        onSetReplaySpeed={onSetReplaySpeed}
      />
    );
  }

  const dispatchCount =
    dispatch.dispatchState !== DispatchState.BROWSE ? dispatch.selectedForDispatch.length : 0;
  const incidentCount = incidents.incidents.length;
  const panelOpen = openCluster != null && PANEL_CLUSTERS.has(openCluster);

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

  const HEALTH_DOT_BG: Record<StatusTone, string> = {
    ok: "bg-status-ok",
    warn: "bg-status-warn",
    error: "bg-status-error",
    idle: "bg-status-idle",
    accent: "bg-accent",
  };

  return (
    <>
      <DockPanel
        open={panelOpen}
        onClose={close}
        dockRef={dockRef}
        contentKey={openCluster ?? "none"}
        aria-label={openCluster ? PANEL_LABEL[openCluster] : undefined}
      >
        {openCluster === "fleet-dispatch" && (
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
          />
        )}
        {openCluster === "tempo" && (
          <TempoPanel clock={clock} onSetMultiplier={setSpeedMultiplier} />
        )}
        {openCluster === "sinks-source" && <SinksPanel adapter={adapter} />}
        {openCluster === "monitor" && (
          <MonitorPanel
            incidents={incidents}
            geofences={geofences}
            analytics={analytics}
            toggles={toggles}
            recordings={recordings}
            advanced={advanced}
          />
        )}
      </DockPanel>

      <div ref={dockRef} className={cn(DOCK_CLASS, className)}>
        <PlaybackCluster
          isRecording={isRecording}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
        />

        <Divider />

        <TempoInline
          clock={clock}
          onSetMultiplier={setSpeedMultiplier}
          detailsOpen={isOpen("tempo")}
          onToggleDetails={() => toggle("tempo")}
          buttonRef={tempoBtnRef}
        />

        <Divider />

        <div className="flex items-center gap-1 px-2">
          <DockCluster
            icon={<CarIcon />}
            label="Fleet"
            active={isOpen("fleet-dispatch")}
            badge={countBadge(dispatchCount, "accent")}
            aria-label="Fleet & Dispatch"
            onClick={() => toggle("fleet-dispatch")}
          />
          <DockCluster
            icon={<Gear />}
            label="Sinks"
            active={isOpen("sinks-source")}
            badge={
              <span
                className={cn(
                  "block size-2 rounded-full border-[1.5px] border-glass-bot",
                  HEALTH_DOT_BG[adapterTone(adapter.health)]
                )}
              />
            }
            aria-label="Sinks & Source"
            onClick={() => toggle("sinks-source")}
          />
          <DockCluster
            icon={<ChartIcon />}
            label="Monitor"
            active={isOpen("monitor")}
            badge={countBadge(incidentCount, "err")}
            aria-label="Monitor"
            onClick={() => toggle("monitor")}
          />
        </div>

        {/* Status chips are the first thing to drop on a narrow viewport —
            they're glanceable, not interactive, so the dock stays usable. */}
        <div className="hidden items-stretch sm:flex">
          <Divider />
          <StatusChips
            chips={[
              { key: "ws", label: "WS", active: connected },
              { key: "sim", label: "SIM", active: status.running },
            ]}
          />
        </div>
      </div>
    </>
  );
}

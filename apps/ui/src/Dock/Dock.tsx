import { cn } from "@/lib/utils";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import type { ComponentProps } from "react";
import type { Fleet, ReplayStatus, SimulationStatus, Vehicle } from "@/types";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import StatusChips from "./StatusChips";
import PlaybackCluster from "./PlaybackCluster";
import TempoCluster from "./TempoCluster";
import FleetDispatchDrawer from "./FleetDispatchDrawer";
import SinksSourceDrawer from "./SinksSourceDrawer";
import MonitorDrawer from "./MonitorDrawer";
import ReplayDock from "./ReplayDock";
import type AdvancedTuningTab from "./AdvancedTuningTab";
import type Incidents from "@/Controls/Incidents";
import type GeofencePanel from "@/Controls/GeofencePanel";
import type AnalyticsPanel from "@/Controls/AnalyticsPanel";
import type TogglesPanel from "@/Controls/TogglesPanel";
import type RecordReplay from "@/Controls/RecordReplay";

/* ── Dock container styling (glass overlay floating over the map) ──
   Same glass/blur/shadow treatment as the old `Controls/BottomDock.tsx`'s
   `DOCK_CLASS`, widened to fit five clusters plus the status chips. */
const DOCK_CLASS = cn(
  "absolute bottom-5 left-1/2 z-40 flex h-16 -translate-x-1/2 translate-y-3.5 items-center gap-2 px-4",
  "rounded-lg border border-border surface-glass shadow-elevated backdrop-blur-md",
  "pointer-events-none opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
  "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-y-0 [[data-ready]_&]:opacity-100"
);

export interface DockProps {
  /** WebSocket connection state, surfaced via the pinned status chips. */
  connected: boolean;
  /** Simulation running/interval status. */
  status: SimulationStatus;
  /** Recording state, owned by a single `useRecording()` call in `App.tsx`. */
  isRecording: boolean;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<unknown>;

  /** Replay transport — when `replayStatus.mode === "replay"` the whole dock
   * swaps to `ReplayDock`, matching the old `BottomDock` swap behavior. */
  replayStatus: ReplayStatus;
  onPauseReplay: () => Promise<void>;
  onResumeReplay: () => Promise<void>;
  onStopReplay: () => Promise<void>;
  onSeekReplay: (timestamp: number) => Promise<void>;
  onSetReplaySpeed: (speed: number) => Promise<void>;

  // ── Fleet & Dispatch cluster ──
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

  // ── Monitor cluster (each bag matches its panel's own prop type) ──
  incidents: ComponentProps<typeof Incidents>;
  geofences: ComponentProps<typeof GeofencePanel>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  toggles: ComponentProps<typeof TogglesPanel>;
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;

  className?: string;
}

/**
 * Root persistent transport-bar dock (see the design doc's "Dock anatomy"
 * section). Owns the single `useDockNavigation()` instance and threads its
 * `isOpen`/`toggle`/`close` down to each cluster so only one drawer is ever
 * open at a time. Swaps entirely to `ReplayDock` while a recording is being
 * replayed.
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
  const { toggle, close, isOpen } = useDockNavigation();

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

  return (
    <div className={cn(DOCK_CLASS, className)}>
      <div className="flex items-center gap-1">
        <PlaybackCluster
          isOpen={isOpen("playback")}
          onToggle={() => toggle("playback")}
          onClose={close}
          isRecording={isRecording}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
        />
        <TempoCluster isOpen={isOpen("tempo")} onToggle={() => toggle("tempo")} onClose={close} />
        <FleetDispatchDrawer
          isOpen={isOpen("fleet-dispatch")}
          onToggle={() => toggle("fleet-dispatch")}
          onClose={close}
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
        <SinksSourceDrawer
          isOpen={isOpen("sinks-source")}
          onToggle={() => toggle("sinks-source")}
          onClose={close}
        />
        <MonitorDrawer
          isOpen={isOpen("monitor")}
          onToggle={() => toggle("monitor")}
          onClose={close}
          incidents={incidents}
          geofences={geofences}
          analytics={analytics}
          toggles={toggles}
          recordings={recordings}
          advanced={advanced}
        />
      </div>

      <div className="flex-1" />

      <StatusChips
        chips={[
          { key: "ws", label: "WS", active: connected },
          { key: "sim", label: "SIM", active: status.running },
        ]}
      />
    </div>
  );
}

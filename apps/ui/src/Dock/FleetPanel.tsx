import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { Fleet, Vehicle } from "@/types";
import Vehicles from "@/Controls/Vehicles";
import Fleets from "@/Controls/Fleets";
import JobsPanel, { type JobsPanelProps } from "@/Controls/JobsPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { Hairline, PanelScroll, StatusDot, mono } from "./DockPanelKit";
import type { FleetTabId } from "./dockSections";

export interface FleetPanelProps {
  /** Which of the Fleet dock's buttons is lit. */
  tab: FleetTabId;
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
  jobs: JobsPanelProps;
}

/**
 * Fleet counts for the panel's summary strip: total, enroute/idle from live
 * speed, failed dispatches, and the live job count.
 */
function FleetSummary({
  total,
  enroute,
  idle,
  alert,
  jobs,
  breached,
}: {
  total: number;
  enroute: number;
  idle: number;
  alert: number;
  jobs: number;
  breached: number;
}) {
  return (
    <div
      className={cn(
        mono,
        "flex items-center gap-2.5 whitespace-nowrap px-[15px] py-2 text-[11px] text-muted-foreground"
      )}
    >
      <span>
        <span className="font-semibold text-foreground">{total}</span> total
      </span>
      <span className="flex items-center gap-1 text-status-ok">
        <StatusDot tone="ok" />
        <span className="font-semibold">{enroute}</span>
      </span>
      <span className="flex items-center gap-1">
        <StatusDot tone="idle" />
        <span className="font-semibold text-foreground">{idle}</span>
      </span>
      {alert > 0 && (
        <span className="flex items-center gap-1 text-status-warn">
          <StatusDot tone="warn" />
          <span className="font-semibold">{alert}</span>
        </span>
      )}
      {jobs > 0 && (
        <span
          className={cn(
            "flex items-center gap-1",
            breached > 0 ? "text-status-error" : "text-muted-foreground"
          )}
          title={breached > 0 ? `${jobs} live jobs, ${breached} past SLA` : `${jobs} live jobs`}
        >
          <span className="font-semibold">{jobs}</span> jobs
        </span>
      )}
    </div>
  );
}

/**
 * The one thing the dock's mode rail can't say for dispatch: why a dispatch
 * failed. Progress, counts, the primary action and the way out all live on the
 * rail.
 */
function DispatchError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="border-t border-border bg-status-error/[0.07] px-[15px] py-2 text-[11px] leading-tight text-status-error">
      {error}
    </div>
  );
}

/**
 * Contents of the Fleet panel — content only. The List / Groups / Dispatch /
 * Jobs switch is the Fleet dock's own row of buttons now, so this component
 * neither owns tab state nor draws a tab strip; it renders whichever leaf the
 * dock says is lit.
 */
export default function FleetPanel({
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
}: FleetPanelProps) {
  const stats = useMemo(() => {
    let enroute = 0;
    for (const v of vehicles) {
      if (v.speed > 0) enroute += 1;
    }
    return {
      total: vehicles.length,
      enroute,
      idle: vehicles.length - enroute,
      alert: dispatch.results.filter((r) => r.status === "error").length,
    };
  }, [vehicles, dispatch.results]);

  return (
    <>
      <FleetSummary
        total={stats.total}
        enroute={stats.enroute}
        idle={stats.idle}
        alert={stats.alert}
        jobs={jobs.counts.live}
        breached={jobs.counts.breached}
      />
      <Hairline />

      {tab === "jobs" ? (
        <PanelScroll>
          <JobsPanel {...jobs} />
        </PanelScroll>
      ) : tab === "groups" ? (
        <PanelScroll>
          <SuppressPanelHeader>
            <Fleets
              fleets={fleets}
              vehicles={vehicles}
              onCreateFleet={onCreateFleet}
              onDeleteFleet={onDeleteFleet}
              onAssignVehicle={onAssignVehicle}
              onUnassignVehicle={onUnassignVehicle}
              error={fleetsError}
            />
          </SuppressPanelHeader>
        </PanelScroll>
      ) : (
        // Bounded height so the virtualized vehicle list measures a real
        // window (PanelScroll's auto-height would starve react-window).
        <div className="flex h-[min(50vh,400px)] min-h-0 flex-col">
          <SuppressPanelHeader>
            <Vehicles
              filter={filter}
              onFilterChange={onFilterChange}
              vehicles={vehicles}
              selectedId={selectedId}
              onSelectVehicle={onSelectVehicle}
              onHoverVehicle={onHoverVehicle}
              onUnhoverVehicle={onUnhoverVehicle}
              maxSpeed={maxSpeed}
              vehicleFleetMap={vehicleFleetMap}
              dispatchState={dispatch.dispatchState}
              selectedForDispatch={dispatch.selectedForDispatch}
              onToggleVehicleForDispatch={dispatch.onToggleVehicleForDispatch}
              assignments={dispatch.assignments}
              results={dispatch.results}
              jobByVehicleId={jobs.jobByVehicleId}
            />
          </SuppressPanelHeader>
        </div>
      )}

      <DispatchError error={dispatch.error} />
    </>
  );
}

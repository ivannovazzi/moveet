import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { Fleet, Vehicle } from "@/types";
import Vehicles from "@/Controls/Vehicles";
import Fleets from "@/Controls/Fleets";
import JobsPanel, { type JobsPanelProps } from "@/Controls/JobsPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { Hairline, PANEL_BODY_H, PanelScroll, StatusDot, mono } from "./DockPanelKit";
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
    <div className="flex items-center gap-2.5 whitespace-nowrap px-[15px] py-2 text-meta text-muted-foreground">
      <span>
        <span className={cn(mono, "font-semibold text-foreground")}>{total}</span> vehicles
      </span>
      <span className="flex items-center gap-1 text-status-ok">
        <StatusDot tone="ok" />
        <span className={cn(mono, "font-semibold")}>{enroute}</span> moving
      </span>
      <span className="flex items-center gap-1">
        <StatusDot tone="idle" />
        <span className={cn(mono, "font-semibold text-foreground")}>{idle}</span> idle
      </span>
      {alert > 0 && (
        <span className="flex items-center gap-1 text-status-warn">
          <StatusDot tone="warn" />
          <span className={cn(mono, "font-semibold")}>{alert}</span> alerts
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
          <span className={cn(mono, "font-semibold")}>{jobs}</span> jobs
          {breached > 0 && (
            <>
              {" "}
              (<span className={cn(mono, "font-semibold")}>{breached}</span> late)
            </>
          )}
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
    <div className="border-t border-border bg-status-error/[0.07] px-[15px] py-2 text-meta leading-tight text-status-error">
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

  // The roster summary belongs to the views that show the roster. Over Jobs it
  // was counting one thing while the body listed another, and over Dispatch the
  // mode rail is already reporting the selection.
  const showSummary = tab === "list" || tab === "groups";

  return (
    <>
      {showSummary && (
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
        </>
      )}

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
        // window (PanelScroll's auto-height would starve react-window) — the
        // same envelope every other view scrolls inside, so the panel's top
        // edge doesn't hop as you step between the Fleet views.
        <div className={cn("flex min-h-0 flex-col", PANEL_BODY_H)}>
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

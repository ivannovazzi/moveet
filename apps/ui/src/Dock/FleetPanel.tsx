import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { Fleet, Vehicle } from "@/types";
import Vehicles from "@/Controls/Vehicles";
import Fleets from "@/Controls/Fleets";
import JobsPanel, { type JobsPanelProps } from "@/Controls/JobsPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import {
  Hairline,
  PanelHead,
  PanelScroll,
  SegTabs,
  StatusDot,
  mono,
  type SegTab,
} from "./DockPanelKit";

export interface FleetPanelProps {
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
  /**
   * Enters dispatch mode *through the mode guard* — switching tabs used to
   * silently discard an in-progress geofence polygon or job placement.
   */
  onEnterDispatch: () => void;
  jobs: JobsPanelProps;
}

type FleetTab = "list" | "groups" | "dispatch" | "jobs";

/**
 * Summary stats for the panel header's `right` slot (mockup `.p-sub`, hoisted
 * inline): total unit count plus enroute / idle breakdown derived from live
 * speed, and an alert count surfaced only when a dispatch produced failures.
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
  /** Live job count — shown only when there is work on the board. */
  jobs: number;
  breached: number;
}) {
  return (
    <div
      className={cn(
        mono,
        "flex shrink-0 items-center gap-2.5 self-center whitespace-nowrap text-[11px] text-muted-foreground"
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
 * rail now — this panel used to repeat them in a footer with different verbs
 * ("Exit" / "Clear" / "Done") from the banner saying the same thing on the
 * other side of the screen.
 */
function DispatchError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="flex-shrink-0 border-t border-border bg-status-error/[0.07] px-[15px] py-2 text-[11px] leading-tight text-status-error">
      {error}
    </div>
  );
}

/**
 * Fleet & Dispatch dock panel. Owns the panel header (title + summary stats)
 * and the List / Groups / Dispatch segmented switch, then renders the shared
 * `Vehicles` and `Fleets` leaves — wrapped in `SuppressPanelHeader` so their
 * own `PanelHeader` collapses (we already own the title) while their in-body
 * controls (the vehicle search box, fleet CRUD) stay intact.
 *
 * The "Dispatch" segment mirrors `dispatch.dispatchMode`: selecting it enters
 * dispatch mode (through the guard), selecting List/Groups exits it. Live
 * dispatch progress and its actions belong to the dock's mode rail, so this
 * panel only adds what the rail has no room for: the failure message. The state
 * machine (`useDispatchState`/`useDispatchFlow`) is unchanged.
 */
export default function FleetPanel({
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
  onEnterDispatch,
  jobs,
}: FleetPanelProps) {
  const [browseTab, setBrowseTab] = useState<"list" | "groups" | "jobs">("list");

  const inDispatch = dispatch.dispatchMode;
  // Dispatch mode wins over the local browse tab so the segment reflects the
  // real (map-affecting) dispatch state, not a stale local selection.
  const activeTab: FleetTab = inDispatch ? "dispatch" : browseTab;

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

  const tabs: SegTab<FleetTab>[] = [
    { value: "list", label: "List" },
    { value: "groups", label: "Groups", count: fleets.length },
    { value: "dispatch", label: "Dispatch" },
    { value: "jobs", label: "Jobs", count: jobs.counts.live },
  ];

  const handleTabChange = (value: FleetTab) => {
    if (value === "dispatch") {
      if (!inDispatch) onEnterDispatch();
      return;
    }
    if (inDispatch) dispatch.toggleDispatchMode();
    // Leaving the Jobs tab abandons a half-placed job rather than leaving the
    // map in a picking mode with no visible affordance.
    if (activeTab === "jobs" && value !== "jobs" && jobs.draft.active) jobs.draft.cancel();
    setBrowseTab(value);
  };

  const showGroups = activeTab === "groups";
  const showJobs = activeTab === "jobs";

  return (
    <>
      <PanelHead
        eyebrow="Fleet & Dispatch"
        title="Fleet"
        right={
          <FleetSummary
            total={stats.total}
            enroute={stats.enroute}
            idle={stats.idle}
            alert={stats.alert}
            jobs={jobs.counts.live}
            breached={jobs.counts.breached}
          />
        }
      />
      <Hairline />
      <SegTabs tabs={tabs} value={activeTab} onChange={handleTabChange} ariaLabel="Fleet views" />

      {showJobs ? (
        <PanelScroll>
          <JobsPanel {...jobs} />
        </PanelScroll>
      ) : showGroups ? (
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

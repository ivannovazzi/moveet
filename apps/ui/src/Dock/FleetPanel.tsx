import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { Fleet, Vehicle } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import { Button } from "@/components/Inputs";
import Vehicles from "@/Controls/Vehicles";
import Fleets from "@/Controls/Fleets";
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
}

type FleetTab = "list" | "groups" | "dispatch";

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
}: {
  total: number;
  enroute: number;
  idle: number;
  alert: number;
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
    </div>
  );
}

/**
 * Dispatch status/action bar, ported from `FleetDispatchDrawer`'s
 * `DispatchStatusBar` and restyled to the mockup's `.dfoot` (accent-tinted
 * footer). Renders per `DispatchState` straight off the `DispatchFlow` object;
 * the state machine itself (`useDispatchState`/`useDispatchFlow`) is untouched.
 */
function DispatchStatusBar({ dispatch }: { dispatch: DispatchFlow }) {
  const { dispatchState: state, selectedForDispatch, assignments, results, error } = dispatch;

  if (state === DispatchState.BROWSE) return null;

  const footerClass = cn(
    "flex flex-shrink-0 items-center justify-between gap-2.5",
    "border-t border-border bg-accent/[0.07] px-[15px] py-2.5"
  );
  const textClass = "flex items-center gap-2 text-[11.5px] text-muted-foreground";
  const buttonsClass = "flex items-center gap-1.5";
  const errorClass = "mt-1 text-[11px] leading-tight text-status-error";

  if (state === DispatchState.SELECT) {
    return (
      <div className={footerClass}>
        <span className={textClass}>
          {selectedForDispatch.length > 0 ? (
            <>
              <span className={cn(mono, "font-semibold text-foreground")}>
                {selectedForDispatch.length}
              </span>{" "}
              selected — click map to add stops
            </>
          ) : (
            "Select vehicles to dispatch"
          )}
        </span>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" onClick={dispatch.handleDone}>
            Exit
          </Button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.ROUTE) {
    const vehicleCount = assignments.length;
    const stopCount = assignments.reduce((sum, a) => sum + a.waypoints.length, 0);

    return (
      <div className={footerClass}>
        <div>
          <span className={textClass}>
            <span className={cn(mono, "font-semibold text-foreground")}>{vehicleCount}</span>{" "}
            vehicle{vehicleCount !== 1 ? "s" : ""},{" "}
            <span className={cn(mono, "font-semibold text-foreground")}>{stopCount}</span> stop
            {stopCount !== 1 ? "s" : ""}
          </span>
          {error && <p className={errorClass}>{error}</p>}
        </div>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" onClick={dispatch.handleDone}>
            Clear
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={dispatch.handleDispatch}
            isDisabled={assignments.length === 0}
          >
            Dispatch
          </Button>
        </div>
      </div>
    );
  }

  if (state === DispatchState.DISPATCH) {
    return (
      <div className={footerClass}>
        <div>
          <span className={textClass}>
            <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-transparent border-l-accent border-t-accent" />
            Dispatching...
          </span>
          {error && <p className={errorClass}>{error}</p>}
        </div>
        <div className={buttonsClass}>
          <Button variant="outline" size="sm" isDisabled>
            Clear
          </Button>
          <Button variant="default" size="sm" isDisabled>
            Dispatch
          </Button>
        </div>
      </div>
    );
  }

  // DispatchState.RESULTS
  const successes = results.filter((r) => r.status === "ok").length;
  const failures = results.filter((r) => r.status === "error").length;

  return (
    <div className={footerClass}>
      <div>
        <span className={textClass}>
          <span className={cn(mono, "font-semibold text-foreground")}>{successes}</span> dispatched
          {failures > 0 && (
            <>
              , <span className={cn(mono, "font-semibold text-status-error")}>{failures}</span>{" "}
              failed
            </>
          )}
        </span>
        {error && <p className={errorClass}>{error}</p>}
      </div>
      <div className={buttonsClass}>
        {failures > 0 && (
          <Button variant="outline" size="sm" onClick={dispatch.handleRetryFailed}>
            Retry Failed
          </Button>
        )}
        <Button variant="default" size="sm" onClick={dispatch.handleDone}>
          Done
        </Button>
      </div>
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
 * dispatch mode, selecting List/Groups exits it — the segment is the sole entry
 * point (no redundant toggle bar). When the dispatch state machine moves past
 * `BROWSE`, the ported `DispatchStatusBar` renders as the panel footer (and its
 * Exit/Done/Clear actions also unwind dispatch mode). The state machine
 * (`useDispatchState`/`useDispatchFlow`) is unchanged — only its surrounding
 * chrome lives here.
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
}: FleetPanelProps) {
  const [browseTab, setBrowseTab] = useState<"list" | "groups">("list");

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
  ];

  const handleTabChange = (value: FleetTab) => {
    if (value === "dispatch") {
      if (!inDispatch) dispatch.toggleDispatchMode();
      return;
    }
    if (inDispatch) dispatch.toggleDispatchMode();
    setBrowseTab(value);
  };

  const showGroups = activeTab === "groups";

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
          />
        }
      />
      <Hairline />
      <SegTabs tabs={tabs} value={activeTab} onChange={handleTabChange} ariaLabel="Fleet views" />

      {showGroups ? (
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
            />
          </SuppressPanelHeader>
        </div>
      )}

      <DispatchStatusBar dispatch={dispatch} />
    </>
  );
}

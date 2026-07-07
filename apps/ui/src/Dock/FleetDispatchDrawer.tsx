import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import DockCluster from "./DockCluster";
import DockDrawer from "./DockDrawer";
import { CarIcon, LayersIcon } from "@/components/Icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/Inputs";
import Vehicles from "@/Controls/Vehicles";
import Fleets from "@/Controls/Fleets";
import { DispatchState } from "@/hooks/useDispatchState";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import type { Fleet, Vehicle } from "@/types";

type FleetDispatchTab = "vehicles" | "fleets";

export interface FleetDispatchDrawerProps {
  /** Whether this cluster's drawer is currently open. */
  isOpen: boolean;
  /** Toggle this cluster's drawer open/closed (mirrors `useDockNavigation().toggle`). */
  onToggle: () => void;
  /** Close this cluster's drawer (mirrors `useDockNavigation().close`). */
  onClose: () => void;

  // ── Vehicles tab (same data flow as the former `Controls/Vehicles.tsx` mount) ──
  vehicles: Vehicle[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedId?: string;
  onSelectVehicle: (id: string) => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  maxSpeed: number;
  /** id → Fleet map (built once by the caller) — O(1) per-row fleet lookup. */
  vehicleFleetMap: Map<string, Fleet>;

  // ── Fleets tab (same data flow as the former `Controls/Fleets.tsx` mount) ──
  fleets: Fleet[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  fleetsError?: string | null;

  /**
   * The full `useDispatchFlow()` result, threaded straight through from the
   * caller (same hook, same state machine — see `useDispatchState.ts`). The
   * drawer's own footer renders the dispatch status/action bar directly off
   * this object once `dispatchState` moves past `BROWSE`, replacing the
   * standalone `DispatchFooter` overlay.
   */
  dispatch: DispatchFlow;
}

/**
 * Dispatch status/action bar, ported from `Controls/DispatchFooter.tsx` so it
 * can live inside this drawer's own footer area instead of floating as a
 * separate sticky overlay above the dock. Rendering logic per
 * `DispatchState` is unchanged — only the chrome (no longer viewport-wide,
 * anchored inside the drawer shell) and the fact it reads straight off the
 * `DispatchFlow` object instead of a flattened prop set.
 */
function DispatchStatusBar({ dispatch }: { dispatch: DispatchFlow }) {
  const { dispatchState: state, selectedForDispatch, assignments, results, error } = dispatch;

  if (state === DispatchState.BROWSE) return null;

  const footerClass = cn(
    "sticky bottom-0 z-10 flex flex-shrink-0 items-center justify-between gap-2",
    "border-t border-border surface-glass p-3 backdrop-blur-md"
  );
  const textClass = "flex items-center gap-2 text-xs text-muted-foreground";
  const buttonsClass = "flex items-center gap-2";
  const errorClass = "mt-1 text-xs leading-tight text-status-error";

  if (state === DispatchState.SELECT) {
    return (
      <div className={footerClass}>
        <span className={textClass}>
          {selectedForDispatch.length > 0
            ? `${selectedForDispatch.length} selected — click map to add stops`
            : "Select vehicles to dispatch"}
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
            {vehicleCount} vehicle{vehicleCount !== 1 ? "s" : ""}, {stopCount} stop
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
  const text =
    failures > 0 ? `${successes} dispatched, ${failures} failed` : `${successes} dispatched`;

  return (
    <div className={footerClass}>
      <div>
        <span className={textClass}>{text}</span>
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
 * Fleet & Dispatch dock cluster: a `DockCluster` trigger plus its own
 * anchored `DockDrawer`, self-contained per the dock's per-cluster pattern
 * (see `docs/plans/2026-07-07-dock-ui-redesign-design.md`, "Fleet & Dispatch
 * cluster"). Merges `Controls/Vehicles.tsx` and `Controls/Fleets.tsx` as two
 * tabs inside one drawer, and hosts the dispatch status/action bar
 * (`DispatchStatusBar` above) as the drawer's own footer once dispatch state
 * moves past `BROWSE` — replacing the separate floating `DispatchFooter`.
 *
 * The dispatch state machine itself (`useDispatchState.ts` /
 * `useDispatchFlow`) is untouched; this component only relocates its
 * surrounding chrome. Map click-to-add-stops behavior lives entirely in the
 * caller's `useDispatchFlow`/`useMapInteractions` wiring and is unaffected.
 */
export default function FleetDispatchDrawer({
  isOpen,
  onToggle,
  onClose,
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
}: FleetDispatchDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<FleetDispatchTab>("vehicles");

  const dispatchBadge =
    dispatch.dispatchState !== DispatchState.BROWSE && dispatch.selectedForDispatch.length > 0 ? (
      <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-[3px] text-[9px] font-semibold leading-none text-accent-foreground">
        {dispatch.selectedForDispatch.length > 9 ? "9+" : dispatch.selectedForDispatch.length}
      </span>
    ) : undefined;

  return (
    <div className="relative">
      <DockCluster
        ref={triggerRef}
        icon={<CarIcon />}
        label="Fleet"
        active={isOpen}
        badge={dispatchBadge}
        aria-label="Fleet & Dispatch"
        onClick={onToggle}
      />

      <DockDrawer
        open={isOpen}
        onClose={onClose}
        anchorRef={triggerRef}
        aria-label="Fleet & Dispatch"
        className="flex w-80 flex-col"
      >
        <div className="flex h-[440px] max-h-[60vh] min-h-0 flex-col">
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as FleetDispatchTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="flex-shrink-0 border-b border-border-soft px-3 pt-3">
              <TabsList variant="line" className="w-full">
                <TabsTrigger value="vehicles" className="gap-1.5">
                  <CarIcon /> Vehicles
                </TabsTrigger>
                <TabsTrigger value="fleets" className="gap-1.5">
                  <LayersIcon /> Fleets
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="vehicles" className="flex min-h-0 flex-1 flex-col">
              <button
                type="button"
                className={cn(
                  "flex w-full flex-shrink-0 items-center justify-center border-b border-border px-4 py-2.5 text-sm font-medium tracking-wide transition-colors duration-fast ease-standard",
                  dispatch.dispatchMode
                    ? "surface-accent text-accent-foreground shadow-glow-accent"
                    : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                )}
                onClick={dispatch.toggleDispatchMode}
              >
                {dispatch.dispatchMode ? "Exit Dispatch" : "Dispatch"}
              </button>
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
            </TabsContent>

            <TabsContent value="fleets" className="flex min-h-0 flex-1 flex-col">
              <Fleets
                fleets={fleets}
                vehicles={vehicles}
                onCreateFleet={onCreateFleet}
                onDeleteFleet={onDeleteFleet}
                onAssignVehicle={onAssignVehicle}
                onUnassignVehicle={onUnassignVehicle}
                error={fleetsError}
              />
            </TabsContent>
          </Tabs>

          <DispatchStatusBar dispatch={dispatch} />
        </div>
      </DockDrawer>
    </div>
  );
}

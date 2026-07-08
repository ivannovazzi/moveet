import { cn } from "@/lib/utils";
import { memo, useCallback, useMemo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import type { Fleet, Vehicle, DispatchAssignment, DirectionResult } from "@/types";
import { DispatchState } from "@/hooks/useDispatchState";
import { useDirectionContext } from "@/data/useData";
import { useResizeObserver } from "@/hooks/useResizeObserver";
import { PanelBadge, PanelBody, PanelEmptyState, PanelHeader } from "./PanelPrimitives";
import { StatusDot, mono } from "@/Dock/DockPanelKit";
import { Search } from "@/components/Icons";
import { Input } from "@/components/ui/input";

// Row height (px) for the virtualized list — must match the rendered row's
// real height since FixedSizeList positions rows by index * ROW_HEIGHT. The
// tight-technical redesign uses a single-line 30px row (mockup `.trow`)
// separated by hairlines rather than gapped cards, so there is no inter-row
// gap to synthesize (ROW_GAP is 0 and the inset is a no-op).
const ROW_HEIGHT = 30;
const ROW_GAP = 0;

// Shared grid template for the header row and every data row so their columns
// stay pixel-aligned: Unit (flex) · Status · km/h · Route.
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto_2.5rem_auto] items-center gap-x-2.5";

// jsdom's ResizeObserver polyfill (src/test/setup.ts) never invokes its
// callback, so useResizeObserver's measured height stays 0 in tests. Fall
// back to a fixed height so the list still renders a real virtualized
// window (and is testable) before a real ResizeObserver fires in the browser.
const FALLBACK_LIST_HEIGHT = 400;

interface VehicleListProps {
  filter: string;
  vehicles: Vehicle[];
  /** Currently selected vehicle id — derived per-row instead of folded into each Vehicle. */
  selectedId?: string;
  maxSpeed: number;
  onFilterChange: (value: string) => void;
  onSelectVehicle: (id: string) => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  /** id → Fleet map (built once in App.tsx) — O(1) per-row fleet lookup. */
  vehicleFleetMap: Map<string, Fleet>;
  dispatchState?: DispatchState;
  selectedForDispatch?: string[];
  onToggleVehicleForDispatch?: (id: string) => void;
  assignments?: DispatchAssignment[];
  results?: DirectionResult[];
}

function formatRouteDistance(distance?: number) {
  return distance === undefined ? "No route" : `Route ${distance.toFixed(1)} km`;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  truck: "TRK",
  motorcycle: "MC",
  ambulance: "AMB",
  bus: "BUS",
};

function WaypointBadge({ assignment }: { assignment: DispatchAssignment }) {
  const count = assignment.waypoints.length;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-accent/20 bg-accent/10 px-2 py-px text-xs font-medium leading-snug text-accent">
      {count} {count === 1 ? "stop" : "stops"}
    </span>
  );
}

function ResultBadge({ result }: { result: DirectionResult }) {
  if (result.status === "error") {
    return (
      <span className="inline-flex items-center whitespace-nowrap text-xs font-medium leading-snug text-status-error">
        No route
      </span>
    );
  }

  const okClass =
    "inline-flex items-center whitespace-nowrap text-xs font-medium leading-snug text-status-ok";

  // Multi-stop result
  if (result.waypointCount && result.waypointCount > 1) {
    const totalDistance = result.legs
      ? result.legs.reduce((sum, leg) => sum + leg.distance, 0)
      : (result.route?.distance ?? 0);
    return (
      <span className={okClass}>
        {result.waypointCount} stops, {totalDistance.toFixed(1)} km
      </span>
    );
  }

  // Single-stop with ETA
  if (result.eta !== undefined) {
    return <span className={okClass}>ETA {Math.round(result.eta)}s</span>;
  }

  // OK without ETA
  return <span className={okClass}>Dispatched</span>;
}

/**
 * A single vehicle row. Kept as a leaf `React.memo` component with a narrow,
 * mostly-primitive prop shape so a position/heading tick on ONE vehicle
 * (which changes `vehicles` array identity in the parent) does not force
 * every other row to re-render — only the row whose own props actually
 * changed re-renders.
 */
interface VehicleRowProps {
  id: string;
  name: string;
  type: string;
  speed: number;
  routeDistance: number | undefined;
  fleetColor: string | undefined;
  isChecked: boolean;
  isRowSelected: boolean;
  showCheckbox: boolean;
  isDispatch: boolean;
  isResults: boolean;
  isRouteState: boolean;
  assignment: DispatchAssignment | undefined;
  result: DirectionResult | undefined;
  style: React.CSSProperties;
  onSelect: (id: string) => void;
  onToggleForDispatch: ((id: string) => void) | undefined;
  onHover: (id: string) => void;
  onUnhover: () => void;
}

const VehicleRow = memo(function VehicleRow({
  id,
  name,
  type,
  speed,
  routeDistance,
  fleetColor,
  isChecked,
  isRowSelected,
  showCheckbox,
  isDispatch,
  isResults,
  isRouteState,
  assignment,
  result,
  style,
  onSelect,
  onToggleForDispatch,
  onHover,
  onUnhover,
}: VehicleRowProps) {
  const isSelected = !showCheckbox && !isResults && isRowSelected;
  const isDispatchSelected = showCheckbox && isChecked;
  const moving = speed > 0;

  const handleClick = () => {
    if (showCheckbox && onToggleForDispatch) {
      onToggleForDispatch(id);
    } else if (!isDispatch) {
      onSelect(id);
    }
  };

  // Right-hand column: dispatch state takes precedence (stops/result), else
  // the route distance (kept as the full "Route x km" string the tests and
  // tooltip rely on).
  const trailing =
    isResults && result ? (
      <ResultBadge result={result} />
    ) : isRouteState && assignment ? (
      <WaypointBadge assignment={assignment} />
    ) : (
      <span
        className={cn(
          mono,
          "text-[11px]",
          routeDistance !== undefined ? "text-muted-foreground/70" : "text-muted-foreground/40"
        )}
      >
        {routeDistance !== undefined ? formatRouteDistance(routeDistance) : "—"}
      </span>
    );

  return (
    <div style={style} className="px-1.5">
      <button
        className={cn(
          ROW_GRID,
          "h-full w-full cursor-pointer border-t border-border-soft px-2 text-left",
          "transition-colors duration-fast ease-standard hover:bg-foreground/[0.035]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
          isSelected && "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]",
          isDispatchSelected && "bg-accent/5 shadow-[inset_3px_0_0_var(--color-accent)]"
        )}
        type="button"
        onClick={handleClick}
        onMouseEnter={() => onHover(id)}
        onMouseLeave={() => onUnhover()}
        aria-pressed={showCheckbox ? isChecked : isRowSelected}
        aria-label={`${name}, ${Math.round(speed)} km/h, ${formatRouteDistance(routeDistance)}`}
        title={`${name} · ${Math.round(speed)} km/h · ${formatRouteDistance(routeDistance)}`}
      >
        {/* Unit: indicator (fleet dot / dispatch checkbox) + monospace id */}
        <span className="flex min-w-0 items-center gap-2">
          {showCheckbox ? (
            <span
              role="checkbox"
              aria-checked={isChecked}
              aria-label={`Select ${name}`}
              className={cn(
                "size-3 flex-shrink-0 rounded-[3px] border border-foreground/25 transition-colors duration-fast ease-standard",
                isChecked && "border-accent bg-accent"
              )}
            />
          ) : (
            <span
              className="size-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: fleetColor ?? "transparent" }}
            />
          )}
          <span className={cn(mono, "min-w-0 flex-1 truncate text-[11.5px] text-foreground")}>
            {name}
          </span>
          {type && type !== "car" && (
            <span className="flex-shrink-0 rounded-sm bg-foreground/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {VEHICLE_TYPE_LABELS[type] ?? type}
            </span>
          )}
        </span>

        {/* Status: dot + label */}
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot tone={moving ? "ok" : "idle"} />
          {moving ? "enroute" : "idle"}
        </span>

        {/* km/h (unit lives in the header) */}
        <span
          className={cn(
            mono,
            "justify-self-end text-[11.5px]",
            moving ? "text-foreground" : "text-muted-foreground/50"
          )}
        >
          {Math.round(speed)}
        </span>

        {/* Route / dispatch trailing */}
        <span className="flex items-center justify-self-end whitespace-nowrap">{trailing}</span>
      </button>
    </div>
  );
});

interface RowData {
  vehicles: Vehicle[];
  directions: ReturnType<typeof useDirectionContext>["directions"];
  vehicleFleetMap: Map<string, Fleet>;
  selectedForDispatchSet: Set<string>;
  assignments: DispatchAssignment[] | undefined;
  results: DirectionResult[] | undefined;
  selectedId: string | undefined;
  maxSpeed: number;
  showCheckbox: boolean;
  isDispatch: boolean;
  isResults: boolean;
  isRouteState: boolean;
  onSelectVehicle: (id: string) => void;
  onToggleVehicleForDispatch: ((id: string) => void) | undefined;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
}

/**
 * Row renderer handed to `FixedSizeList`. Derives per-row values from the
 * shared `itemData` and forwards a narrow, primitive prop set to the memoized
 * `VehicleRow` so unrelated vehicle updates don't force a re-render here.
 */
function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const {
    vehicles,
    directions,
    vehicleFleetMap,
    selectedForDispatchSet,
    assignments,
    results,
    selectedId,
    showCheckbox,
    isDispatch,
    isResults,
    isRouteState,
    onSelectVehicle,
    onToggleVehicleForDispatch,
    onHoverVehicle,
    onUnhoverVehicle,
  } = data;

  const vehicle = vehicles[index];
  const routeDistance = directions.get(vehicle.id)?.route.distance;
  const vehicleFleet = vehicleFleetMap.get(vehicle.id);
  const isChecked = selectedForDispatchSet.has(vehicle.id);
  const assignment = assignments?.find((a) => a.vehicleId === vehicle.id);
  const result = results?.find((r) => r.vehicleId === vehicle.id);

  // Inset the row within its slot to reproduce the previous flex `gap`
  // spacing, which react-window's absolutely-positioned items don't get.
  const insetStyle: React.CSSProperties = {
    ...style,
    top: (style.top as number) + ROW_GAP / 2,
    height: (style.height as number) - ROW_GAP,
  };

  return (
    <VehicleRow
      id={vehicle.id}
      name={vehicle.name}
      type={vehicle.type}
      speed={vehicle.speed}
      routeDistance={routeDistance}
      fleetColor={vehicleFleet?.color}
      isChecked={isChecked}
      isRowSelected={selectedId === vehicle.id}
      showCheckbox={showCheckbox}
      isDispatch={isDispatch}
      isResults={isResults}
      isRouteState={isRouteState}
      assignment={assignment}
      result={result}
      style={insetStyle}
      onSelect={onSelectVehicle}
      onToggleForDispatch={onToggleVehicleForDispatch}
      onHover={onHoverVehicle}
      onUnhover={onUnhoverVehicle}
    />
  );
}

export default function VehicleList({
  filter,
  vehicles,
  selectedId,
  maxSpeed,
  onFilterChange,
  onSelectVehicle,
  onHoverVehicle,
  onUnhoverVehicle,
  vehicleFleetMap,
  dispatchState,
  selectedForDispatch,
  onToggleVehicleForDispatch,
  assignments,
  results,
}: VehicleListProps) {
  const { directions } = useDirectionContext();
  const visibleVehicles = useMemo(() => vehicles.filter((v) => v.visible), [vehicles]);

  // O(1) membership test per row instead of array.includes() per row.
  const selectedForDispatchSet = useMemo(
    () => new Set(selectedForDispatch ?? []),
    [selectedForDispatch]
  );

  const isSelectOrRoute =
    dispatchState === DispatchState.SELECT || dispatchState === DispatchState.ROUTE;
  const isDispatch = dispatchState === DispatchState.DISPATCH;
  const isResults = dispatchState === DispatchState.RESULTS;
  const showCheckbox = isSelectOrRoute || isDispatch;
  const isRouteState = dispatchState === DispatchState.ROUTE;

  const [listRef, listSize] = useResizeObserver();
  const listHeight = listSize.height > 0 ? listSize.height : FALLBACK_LIST_HEIGHT;

  const itemKey = useCallback((index: number, data: RowData) => data.vehicles[index].id, []);

  const itemData: RowData = useMemo(
    () => ({
      vehicles: visibleVehicles,
      directions,
      vehicleFleetMap,
      selectedForDispatchSet,
      assignments,
      results,
      selectedId,
      maxSpeed,
      showCheckbox,
      isDispatch,
      isResults,
      isRouteState,
      onSelectVehicle,
      onToggleVehicleForDispatch,
      onHoverVehicle,
      onUnhoverVehicle,
    }),
    [
      visibleVehicles,
      directions,
      vehicleFleetMap,
      selectedForDispatchSet,
      assignments,
      results,
      selectedId,
      maxSpeed,
      showCheckbox,
      isDispatch,
      isResults,
      isRouteState,
      onSelectVehicle,
      onToggleVehicleForDispatch,
      onHoverVehicle,
      onUnhoverVehicle,
    ]
  );

  return (
    <>
      <PanelHeader
        title="Vehicles"
        subtitle={
          filter
            ? `Showing ${visibleVehicles.length} of ${vehicles.length} matching "${filter}"`
            : `${vehicles.length} tracked units`
        }
        badge={<PanelBadge>{visibleVehicles.length}</PanelBadge>}
      />

      <PanelBody
        padded={false}
        scrollable={false}
        className={cn("gap-1.5 p-3", isDispatch && "pointer-events-none opacity-60")}
      >
        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Search vehicles…"
            className="pl-9 pr-10"
            aria-label="Search vehicles"
          />
          {filter && (
            <button
              type="button"
              onClick={() => onFilterChange("")}
              className="absolute right-2 flex size-6 items-center justify-center rounded-md border border-transparent bg-accent/50 text-base leading-none text-muted-foreground transition-colors duration-fast ease-standard hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {visibleVehicles.length === 0 ? (
          <PanelEmptyState>
            {filter ? `No vehicles match "${filter}"` : "No vehicles"}
          </PanelEmptyState>
        ) : (
          <>
            {/* Sticky column header — aligned to the row grid, scrolls with
                neither rows nor the list (mockup `.thead`). */}
            <div className="px-1.5" aria-hidden="true">
              <div
                className={cn(
                  ROW_GRID,
                  "h-6 px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground/75"
                )}
              >
                <span>Unit</span>
                <span>Status</span>
                <span className="justify-self-end">km/h</span>
                <span className="justify-self-end">Route</span>
              </div>
            </div>
            <div ref={listRef} className="min-h-0 flex-1">
              <FixedSizeList
                height={listHeight}
                width="100%"
                itemCount={visibleVehicles.length}
                itemSize={ROW_HEIGHT}
                itemKey={itemKey}
                itemData={itemData}
                overscanCount={6}
              >
                {Row}
              </FixedSizeList>
            </div>
          </>
        )}
      </PanelBody>
    </>
  );
}

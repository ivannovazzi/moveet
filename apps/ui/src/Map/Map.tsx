import { lazy, Suspense, useCallback, useMemo } from "react";
import type { PickingInfo } from "@deck.gl/core";
import type {
  DispatchAssignment,
  Fleet,
  IncidentDTO,
  Modifiers,
  POI,
  Position,
  Road,
  RoadNetwork,
  Vehicle,
  VehicleType,
} from "@/types";
import type { BoundingBox, GeoFence } from "@moveet/shared-types";
import type { Filters } from "@/hooks/useVehicles";
import { DispatchState, cursorForDispatchState } from "@/hooks/useDispatchState";
import type { WaypointRef } from "@/hooks/useDispatchFlow";

// Lazily load the WebGL canvas so the app shell + control panels can paint
// before the deck.gl/luma.gl stack (its own `deckgl` vendor chunk) is fetched
// and the GL context is created. DeckGLMap is a named export, so adapt it to a
// default export for React.lazy.
const DeckGLMap = lazy(() =>
  import("@/components/Map/components/DeckGLMap").then((m) => ({ default: m.DeckGLMap }))
);
import VehiclesLayer from "./Vehicle/VehiclesLayer";
import Direction from "./Direction";
import RoadRenderer from "./Road";
import PendingDispatch from "./PendingDispatch";
import IncidentMarkers from "./IncidentMarkers";
import { isPOI, isRoad } from "@/utils/typeGuards";
import POIMarker from "./POI/POI";
import GeofenceLayer from "./Geofence/GeofenceLayer";
import GeofenceDrawTool from "./Geofence/GeofenceDrawTool";
import { ViewportBboxReporter } from "./ViewportBboxReporter";

// Stable fallback for optional callbacks — inline `() => {}` literals would
// hand child layers a new prop identity on every render.
const NOOP = () => {};

// deck.gl's getTooltip renders raw HTML outside the React tree — escape
// vehicle/fleet names before interpolating them into the tooltip markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const Heatmap = lazy(() => import("./Heatmap"));
const POIs = lazy(() => import("./POIs"));
const TrafficZones = lazy(() => import("./TrafficZones"));
const TrafficOverlay = lazy(() => import("./TrafficOverlay"));
const BreadcrumbLayer = lazy(() => import("./Breadcrumb/BreadcrumbLayer"));
const SpeedLimitSigns = lazy(() => import("./SpeedLimitSigns"));

interface MapProps {
  network: RoadNetwork;
  filters: Filters;
  vehicles: Vehicle[];
  modifiers: Modifiers;
  selectedItem: Road | POI | null;
  onClick: (id: string) => void;
  onMapClick?: (event: React.MouseEvent, position: Position) => void;
  onMapContextClick: (evt: React.MouseEvent, position: Position) => void;
  onPOIClick: (poi: POI) => void;
  onHoverVehicle?: (id: string | undefined) => void;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
  dispatchState?: DispatchState;
  assignments?: DispatchAssignment[];
  onMoveWaypointGroup?: (refs: WaypointRef[], newLat: number, newLng: number) => void;
  onRemoveWaypointGroup?: (refs: WaypointRef[]) => void;
  incidents?: IncidentDTO[];
  fences?: GeoFence[];
  selectedFenceId?: string;
  onFenceClick?: (id: string) => void;
  drawingActive?: boolean;
  onDrawComplete?: (polygon: [number, number][]) => void;
  onDrawVertexCountChange?: (count: number) => void;
  drawConfirmId?: number;
  onBboxChange?: (bbox: BoundingBox | null) => void;
}

export default function Map({
  network,
  vehicles,
  modifiers,
  filters,
  selectedItem,
  onClick,
  onMapClick,
  onMapContextClick,
  onPOIClick,
  onHoverVehicle,
  vehicleFleetMap,
  hiddenFleetIds,
  hiddenVehicleTypes,
  dispatchState,
  assignments = [],
  onMoveWaypointGroup,
  onRemoveWaypointGroup,
  incidents,
  fences = [],
  selectedFenceId,
  onFenceClick,
  drawingActive = false,
  onDrawComplete,
  onDrawVertexCountChange,
  drawConfirmId,
  onBboxChange,
}: MapProps) {
  // Derive cursor: prefer dispatchState if provided, fall back to dispatchMode boolean
  const cursor = dispatchState ? cursorForDispatchState(dispatchState) : "grab";

  // Native deck.gl tooltip for GL-picked layers (currently just vehicles —
  // POIs/incidents render their own styled HTML markers instead). Hover is
  // infrequent, so a linear scan over `vehicles` is fine — no need for a
  // memoized id index.
  const getTooltip = useCallback(
    (info: PickingInfo) => {
      if (info.layer?.id !== "vehicles" || !info.object) return null;
      const vehicle = vehicles.find((v) => v.id === (info.object as { id: string }).id);
      if (!vehicle) return null;
      const fleet = vehicleFleetMap.get(vehicle.id);
      return {
        html: `<div class="rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-xs shadow-elevated backdrop-blur-md">
          <div class="font-medium text-foreground">${escapeHtml(vehicle.name)}</div>
          <div class="text-muted-foreground">${escapeHtml(fleet?.name ?? vehicle.type)} · ${Math.round(vehicle.speed)} km/h</div>
        </div>`,
        style: { backgroundColor: "transparent", border: "none", padding: "0", margin: "8px" },
      };
    },
    [vehicles, vehicleFleetMap]
  );

  // Only rebuild the HTML marker subtree when its actual inputs change, so
  // DeckGLMap doesn't receive a new htmlMarkers element on unrelated renders.
  const htmlMarkers = useMemo(
    () => (
      <>
        {selectedItem && isPOI(selectedItem) && <POIMarker poi={selectedItem} showLabel />}
        {incidents && incidents.length > 0 && <IncidentMarkers incidents={incidents} />}
      </>
    ),
    [selectedItem, incidents]
  );

  return (
    <Suspense fallback={null}>
      <DeckGLMap
        data={network}
        strokeOpacity={modifiers.showDirections ? 0.4 : 0}
        strokeColor="#444"
        strokeWidth={1.5}
        onClick={onMapClick}
        onContextClick={onMapContextClick}
        cursor={cursor}
        htmlMarkers={htmlMarkers}
        getTooltip={getTooltip}
      >
        {/* POIs & speed-limit signs — GPU-rendered via IconLayer */}
        {modifiers.showPOIs && (
          <Suspense fallback={null}>
            <POIs visible={modifiers.showPOIs} onClick={onPOIClick} />
          </Suspense>
        )}
        {modifiers.showSpeedLimits && (
          <Suspense fallback={null}>
            <SpeedLimitSigns visible={modifiers.showSpeedLimits} />
          </Suspense>
        )}
        {/* Geofence zones — rendered between roads and vehicles */}
        {fences.length > 0 && (
          <GeofenceLayer
            fences={fences}
            selectedFenceId={selectedFenceId}
            onFenceClick={onFenceClick}
          />
        )}
        <Direction selected={filters.selected} hovered={filters.hovered} />
        {modifiers.showBreadcrumbs && (
          <Suspense fallback={null}>
            <BreadcrumbLayer
              selectedId={filters.selected}
              showAll={true}
              vehicleFleetMap={vehicleFleetMap}
              hiddenFleetIds={hiddenFleetIds}
            />
          </Suspense>
        )}
        {modifiers.showHeatzones && (
          <Suspense fallback={null}>
            <TrafficZones visible={modifiers.showHeatzones} />
          </Suspense>
        )}
        {modifiers.showTrafficOverlay && (
          <Suspense fallback={null}>
            <TrafficOverlay visible={true} />
          </Suspense>
        )}

        {modifiers.showVehicles && (
          <VehiclesLayer
            scale={1.5}
            vehicleFleetMap={vehicleFleetMap}
            hiddenFleetIds={hiddenFleetIds}
            hiddenVehicleTypes={hiddenVehicleTypes}
            selectedId={filters.selected}
            hoveredId={filters.hovered}
            onClick={onClick}
            onHover={onHoverVehicle}
          />
        )}
        {modifiers.showHeatmap && (
          <Suspense fallback={null}>
            <Heatmap vehicles={vehicles} />
          </Suspense>
        )}
        {selectedItem && isRoad(selectedItem) && <RoadRenderer road={selectedItem} />}
        {assignments.length > 0 && (
          <PendingDispatch
            assignments={assignments}
            vehicles={vehicles}
            editable={dispatchState === DispatchState.ROUTE}
            onMoveWaypointGroup={onMoveWaypointGroup ?? NOOP}
            onRemoveWaypointGroup={onRemoveWaypointGroup ?? NOOP}
          />
        )}
        <GeofenceDrawTool
          active={drawingActive}
          onComplete={onDrawComplete ?? NOOP}
          onVertexCountChange={onDrawVertexCountChange}
          confirmRequestId={drawConfirmId}
        />
        {onBboxChange && <ViewportBboxReporter onBboxChange={onBboxChange} />}
      </DeckGLMap>
    </Suspense>
  );
}

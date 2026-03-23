import { lazy, Suspense } from "react";
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
import { type DispatchState, cursorForDispatchState } from "@/hooks/useDispatchState";

import { DeckGLMap } from "@/components/Map/components/DeckGLMap";
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
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
  hiddenVehicleTypes: Set<VehicleType>;
  dispatchState?: DispatchState;
  assignments?: DispatchAssignment[];
  incidents?: IncidentDTO[];
  fences?: GeoFence[];
  selectedFenceId?: string;
  drawingActive?: boolean;
  onDrawComplete?: (polygon: [number, number][]) => void;
  onDrawCancel?: () => void;
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
  vehicleFleetMap,
  hiddenFleetIds,
  hiddenVehicleTypes,
  dispatchState,
  assignments = [],
  incidents,
  fences = [],
  selectedFenceId,
  drawingActive = false,
  onDrawComplete,
  onDrawCancel,
  onDrawVertexCountChange,
  drawConfirmId,
  onBboxChange,
}: MapProps) {
  // Derive cursor: prefer dispatchState if provided, fall back to dispatchMode boolean
  const cursor = dispatchState ? cursorForDispatchState(dispatchState) : "grab";

  return (
    <>
      <DeckGLMap
        data={network}
        strokeOpacity={modifiers.showDirections ? 0.4 : 0}
        strokeColor="#444"
        strokeWidth={1.5}
        onClick={onMapClick}
        onContextClick={onMapContextClick}
        cursor={cursor}
        htmlMarkers={
          <>
            {selectedItem && isPOI(selectedItem) && <POIMarker poi={selectedItem} showLabel />}
            {incidents && incidents.length > 0 && <IncidentMarkers incidents={incidents} />}
          </>
        }
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
        {fences.length > 0 && <GeofenceLayer fences={fences} selectedFenceId={selectedFenceId} />}
        <Direction selected={filters.selected} hovered={filters.hovered} />
        {modifiers.showBreadcrumbs && (
          <Suspense fallback={null}>
            <BreadcrumbLayer
              selectedId={filters.selected}
              showAll={false}
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
          />
        )}
        {modifiers.showHeatmap && (
          <Suspense fallback={null}>
            <Heatmap vehicles={vehicles} />
          </Suspense>
        )}
        {selectedItem && isRoad(selectedItem) && <RoadRenderer road={selectedItem} />}
        {assignments.length > 0 && (
          <PendingDispatch assignments={assignments} vehicles={vehicles} />
        )}
        <GeofenceDrawTool
          active={drawingActive}
          onComplete={onDrawComplete ?? (() => {})}
          onCancel={onDrawCancel ?? (() => {})}
          onVertexCountChange={onDrawVertexCountChange}
          confirmRequestId={drawConfirmId}
        />
        {onBboxChange && <ViewportBboxReporter onBboxChange={onBboxChange} />}
      </DeckGLMap>
    </>
  );
}

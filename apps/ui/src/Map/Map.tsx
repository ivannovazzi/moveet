import { lazy, Suspense } from "react";
import type {
  DispatchAssignment,
  Fleet,
  IncidentDTO,
  Modifiers,
  POI,
  Position,
  ReplayStatus,
  Road,
  Vehicle,
} from "@/types";
import type { Filters } from "@/hooks/useVehicles";
import { type DispatchState, cursorForDispatchState } from "@/hooks/useDispatchState";

import { useNetwork } from "@/hooks/useNetwork";
import { RoadNetworkMap } from "@/components/Map/components/RoadNetworkMap";
import VehiclesLayer from "./Vehicle/VehiclesLayer";
import Direction from "./Direction";
import RoadRenderer from "./Road";
import PendingDispatch from "./PendingDispatch";
import IncidentMarkers from "./IncidentMarkers";
import ReplayBar from "./ReplayBar";
import { isPOI, isRoad } from "@/utils/typeGuards";
import POIMarker from "./POI/POI";

const Heatmap = lazy(() => import("./Heatmap"));
const POIs = lazy(() => import("./POIs"));
const TrafficZones = lazy(() => import("./TrafficZones"));

interface MapProps {
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
  dispatchState?: DispatchState;
  assignments?: DispatchAssignment[];
  incidents?: IncidentDTO[];
  replayStatus?: ReplayStatus;
  onPauseReplay?: () => Promise<void>;
  onResumeReplay?: () => Promise<void>;
  onStopReplay?: () => Promise<void>;
  onSeekReplay?: (timestamp: number) => Promise<void>;
  onStartReplay?: (file: string, speed?: number) => Promise<void>;
}

export default function Map({
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
  dispatchState,
  assignments = [],
  incidents,
  replayStatus,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
  onSeekReplay,
  onStartReplay,
}: MapProps) {
  const network = useNetwork();

  // Derive cursor: prefer dispatchState if provided, fall back to dispatchMode boolean
  const cursor = dispatchState ? cursorForDispatchState(dispatchState) : "grab";

  return (
    <>
      <RoadNetworkMap
        data={network}
        strokeOpacity={modifiers.showDirections ? 0.4 : 0}
        strokeColor="#444"
        strokeWidth={1.5}
        onClick={onMapClick}
        onContextClick={onMapContextClick}
        cursor={cursor}
        htmlMarkers={
          <>
            {modifiers.showPOIs && (
              <Suspense fallback={null}>
                <POIs visible={modifiers.showPOIs} onClick={onPOIClick} />
              </Suspense>
            )}
            {selectedItem && isPOI(selectedItem) && <POIMarker poi={selectedItem} showLabel />}
            {incidents && incidents.length > 0 && <IncidentMarkers incidents={incidents} />}
          </>
        }
      >
        {/* <Selection /> */}
        <Direction selected={filters.selected} hovered={filters.hovered} />
        {modifiers.showHeatzones && (
          <Suspense fallback={null}>
            <TrafficZones visible={modifiers.showHeatzones} />
          </Suspense>
        )}

        {modifiers.showVehicles && (
          <VehiclesLayer
            scale={1.5}
            vehicleFleetMap={vehicleFleetMap}
            hiddenFleetIds={hiddenFleetIds}
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
        {assignments.length > 0 && <PendingDispatch assignments={assignments} vehicles={vehicles} />}
      </RoadNetworkMap>
      {replayStatus?.mode === "replay" &&
        onPauseReplay &&
        onResumeReplay &&
        onStopReplay &&
        onSeekReplay &&
        onStartReplay && (
          <ReplayBar
            replayStatus={replayStatus}
            onPauseReplay={onPauseReplay}
            onResumeReplay={onResumeReplay}
            onStopReplay={onStopReplay}
            onSeekReplay={onSeekReplay}
            onStartReplay={onStartReplay}
          />
        )}
    </>
  );
}

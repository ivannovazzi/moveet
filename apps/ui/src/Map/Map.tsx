import { lazy, Suspense } from "react";
import type { DispatchAssignment, Fleet, Modifiers, POI, Position, Road, Vehicle } from "@/types";
import type { Filters } from "@/hooks/useVehicles";

import { useNetwork } from "@/hooks/useNetwork";
import { RoadNetworkMap } from "@/components/Map/components/RoadNetworkMap";
import VehiclesLayer from "./Vehicle/VehiclesLayer";
import Direction from "./Direction";
import RoadRenderer from "./Road";
import PendingDispatch from "./PendingDispatch";
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
  dispatchMode?: boolean;
  assignments?: DispatchAssignment[];
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
  dispatchMode = false,
  assignments = [],
}: MapProps) {
  const network = useNetwork();

  return (
    <RoadNetworkMap
      data={network}
      strokeOpacity={modifiers.showDirections ? 0.4 : 0}
      strokeColor="#444"
      strokeWidth={1.5}
      onClick={onMapClick}
      onContextClick={onMapContextClick}
      dispatchMode={dispatchMode}
      htmlMarkers={
        <>
          {modifiers.showPOIs && (
            <Suspense fallback={null}>
              <POIs visible={modifiers.showPOIs} onClick={onPOIClick} />
            </Suspense>
          )}
          {selectedItem && isPOI(selectedItem) && <POIMarker poi={selectedItem} showLabel />}
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
  );
}

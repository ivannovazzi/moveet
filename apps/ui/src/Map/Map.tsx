import { lazy, Suspense } from "react";
import type { Fleet, Modifiers, POI, Position, Road, Vehicle } from "@/types";
import type { Filters } from "@/hooks/useVehicles";

import { useNetwork } from "@/hooks/useNetwork";
import { RoadNetworkMap } from "@/components/Map/components/RoadNetworkMap";
import VehicleM from "./Vehicle";
import Direction from "./Direction";
import RoadRenderer from "./Road";
import { isPOI, isRoad } from "@/utils/typeGuards";
import POIMarker from "./POI/POI";

const Heatmap = lazy(() => import("./Heatmap"));
const POIs = lazy(() => import("./POIs"));
const TrafficZones = lazy(() => import("./TrafficZones"));

interface MapProps {
  filters: Filters;
  vehicles: Vehicle[];
  animFreq: number;
  modifiers: Modifiers;
  selectedItem: Road | POI | null;
  onClick: (id: string) => void;
  onMapClick?: (event: React.MouseEvent, position: Position) => void;
  onMapContextClick: (evt: React.MouseEvent, position: Position) => void;
  onPOIClick: (poi: POI) => void;
  vehicleFleetMap: Map<string, Fleet>;
  hiddenFleetIds: Set<string>;
}

export default function Map({
  vehicles,
  animFreq,
  modifiers,
  filters,
  selectedItem,
  onClick,
  onMapClick,
  onMapContextClick,
  onPOIClick,
  vehicleFleetMap,
  hiddenFleetIds,
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

      {modifiers.showVehicles &&
        vehicles
          ?.filter((vehicle) => {
            if (vehicle.position[0] === 0 && vehicle.position[1] === 0) return false;
            const fleet = vehicleFleetMap.get(vehicle.id);
            return !fleet || !hiddenFleetIds.has(fleet.id);
          })
          .map((vehicle) => (
            <VehicleM
              key={vehicle.id}
              animFreq={animFreq}
              scale={1.5}
              {...vehicle}
              fleetColor={vehicleFleetMap.get(vehicle.id)?.color}
              onClick={() => onClick(vehicle.id)}
            />
          ))}
      {modifiers.showHeatmap && (
        <Suspense fallback={null}>
          <Heatmap vehicles={vehicles} />
        </Suspense>
      )}
      {selectedItem && isRoad(selectedItem) && <RoadRenderer road={selectedItem} />}
    </RoadNetworkMap>
  );
}

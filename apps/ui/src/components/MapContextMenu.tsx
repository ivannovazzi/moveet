import {
  Ban,
  Construction,
  LocateFixed,
  MapPinPlus,
  Navigation,
  Send,
  TriangleAlert,
} from "lucide-react";
import { DispatchState } from "@/hooks/useDispatchState";
import { useDispatchContext } from "@/hooks/useDispatchFlow";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { IncidentType } from "@/types";

interface MapContextMenuProps {
  onFindDirections: () => void;
  onFindRoad: () => void;
  onSendVehicle: () => void;
  onAddWaypoint: () => void;
  onCreateIncident?: (type: IncidentType) => void;
  hasSelectedVehicle: boolean;
}

/** Identify-closest-road is available in every dispatch state. */
function IdentifyRoadItem({ onFindRoad }: { onFindRoad: () => void }) {
  return (
    <DropdownMenuItem onSelect={onFindRoad}>
      <LocateFixed />
      Identify closest road
    </DropdownMenuItem>
  );
}

export default function MapContextMenu({
  onFindDirections,
  onFindRoad,
  onSendVehicle,
  onAddWaypoint,
  onCreateIncident,
  hasSelectedVehicle,
}: MapContextMenuProps) {
  const { dispatchState: state, selectedForDispatch } = useDispatchContext();
  const hasDispatchSelection = selectedForDispatch.length > 0;

  switch (state) {
    case DispatchState.BROWSE:
      return (
        <>
          <DropdownMenuItem onSelect={onFindDirections}>
            <Navigation />
            Find directions to here
          </DropdownMenuItem>
          <IdentifyRoadItem onFindRoad={onFindRoad} />
          <DropdownMenuItem disabled={!hasSelectedVehicle} onSelect={onSendVehicle}>
            <Send />
            Send selected vehicle here
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TriangleAlert />
              Create incident
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onCreateIncident?.("accident")}>
                <TriangleAlert />
                Accident
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreateIncident?.("closure")}>
                <Ban />
                Closure
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCreateIncident?.("construction")}>
                <Construction />
                Construction
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      );

    case DispatchState.ROUTE:
      return (
        <>
          <DropdownMenuItem disabled={!hasDispatchSelection} onSelect={onAddWaypoint}>
            <MapPinPlus />
            Add waypoint here
          </DropdownMenuItem>
          <IdentifyRoadItem onFindRoad={onFindRoad} />
        </>
      );

    case DispatchState.SELECT:
    case DispatchState.DISPATCH:
    case DispatchState.RESULTS:
      return <IdentifyRoadItem onFindRoad={onFindRoad} />;
  }
}

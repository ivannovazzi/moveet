import { DispatchState } from "@/hooks/useDispatchState";
import { Button } from "@/components/Inputs";
import type { IncidentType } from "@/types";

interface MapContextMenuProps {
  state: DispatchState;
  onFindDirections: () => void;
  onFindRoad: () => void;
  onSendVehicle: () => void;
  onAddWaypoint: () => void;
  onCreateIncident?: (type: IncidentType) => void;
  hasSelectedVehicle: boolean;
  hasDispatchSelection: boolean;
}

export default function MapContextMenu({
  state,
  onFindDirections,
  onFindRoad,
  onSendVehicle,
  onAddWaypoint,
  onCreateIncident,
  hasSelectedVehicle,
  hasDispatchSelection,
}: MapContextMenuProps) {
  switch (state) {
    case DispatchState.BROWSE:
      return (
        <>
          <Button role="menuitem" onClick={onFindDirections}>
            Find Directions To Here
          </Button>
          <Button role="menuitem" onClick={onFindRoad}>
            Identify closest road
          </Button>
          {hasSelectedVehicle && (
            <Button role="menuitem" onClick={onSendVehicle}>
              Send selected vehicle here
            </Button>
          )}
          <Button role="menuitem" onClick={() => onCreateIncident?.("accident")}>
            Create Accident
          </Button>
          <Button role="menuitem" onClick={() => onCreateIncident?.("closure")}>
            Create Closure
          </Button>
          <Button role="menuitem" onClick={() => onCreateIncident?.("construction")}>
            Create Construction
          </Button>
        </>
      );

    case DispatchState.SELECT:
      return (
        <Button role="menuitem" onClick={onFindRoad}>
          Identify closest road
        </Button>
      );

    case DispatchState.ROUTE:
      return (
        <>
          {hasDispatchSelection && (
            <Button role="menuitem" onClick={onAddWaypoint}>
              Add waypoint here
            </Button>
          )}
          <Button role="menuitem" onClick={onFindRoad}>
            Identify closest road
          </Button>
        </>
      );

    case DispatchState.DISPATCH:
      return (
        <Button role="menuitem" onClick={onFindRoad}>
          Identify closest road
        </Button>
      );

    case DispatchState.RESULTS:
      return (
        <Button role="menuitem" onClick={onFindRoad}>
          Identify closest road
        </Button>
      );
  }
}

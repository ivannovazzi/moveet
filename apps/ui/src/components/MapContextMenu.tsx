import { DispatchState } from "@/hooks/useDispatchState";
import { Button } from "@/components/Inputs";

interface MapContextMenuProps {
  state: DispatchState;
  onFindDirections: () => void;
  onFindRoad: () => void;
  onSendVehicle: () => void;
  onAddWaypoint: () => void;
  hasSelectedVehicle: boolean;
  hasDispatchSelection: boolean;
}

export default function MapContextMenu({
  state,
  onFindDirections,
  onFindRoad,
  onSendVehicle,
  onAddWaypoint,
  hasSelectedVehicle,
  hasDispatchSelection,
}: MapContextMenuProps) {
  switch (state) {
    case DispatchState.BROWSE:
      return (
        <>
          <Button onClick={onFindDirections}>Find Directions To Here</Button>
          <Button onClick={onFindRoad}>Identify closest road</Button>
          {hasSelectedVehicle && (
            <Button onClick={onSendVehicle}>Send selected vehicle here</Button>
          )}
        </>
      );

    case DispatchState.SELECT:
      return <Button onClick={onFindRoad}>Identify closest road</Button>;

    case DispatchState.ROUTE:
      return (
        <>
          {hasDispatchSelection && (
            <Button onClick={onAddWaypoint}>Add waypoint here</Button>
          )}
          <Button onClick={onFindRoad}>Identify closest road</Button>
        </>
      );

    case DispatchState.DISPATCH:
      return <Button onClick={onFindRoad}>Identify closest road</Button>;

    case DispatchState.RESULTS:
      return <Button onClick={onFindRoad}>Identify closest road</Button>;
  }
}

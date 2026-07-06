import { cn } from "@/lib/utils";
import type { Fleet, POI, Vehicle } from "@/types";
import { CloseIcon } from "@/components/Icons";
import { Button } from "@/components/Inputs";
import { useDirectionContext } from "@/data/useData";

interface InspectorProps {
  vehicle: Vehicle | null;
  vehicleFleet: Fleet | undefined;
  poi: POI | null;
  onClose: () => void;
}

export default function Inspector({ vehicle, vehicleFleet, poi, onClose }: InspectorProps) {
  const { directions } = useDirectionContext();
  const entity = vehicle ?? poi;
  if (!entity) return null;

  const route = vehicle ? directions.get(vehicle.id)?.route : undefined;
  const title = vehicle ? vehicle.name : (poi?.name ?? "Point of interest");

  return (
    <aside
      className={cn(
        "absolute bottom-0 top-0 right-0 z-30 w-[clamp(280px,26vw,340px)]",
        "flex flex-col overflow-hidden border-l border-border surface-glass shadow-elevated backdrop-blur-2xl",
        "animate-fade-up"
      )}
      aria-label="Inspector"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {vehicleFleet && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{vehicleFleet.name}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          title="Close"
          aria-label="Close inspector"
        >
          <CloseIcon className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {vehicle && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Speed</dt>
            <dd className="text-right tabular-nums text-foreground">
              {Math.round(vehicle.speed)} km/h
            </dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-right capitalize text-foreground">{vehicle.type}</dd>
            {route && (
              <>
                <dt className="text-muted-foreground">Route</dt>
                <dd className="text-right tabular-nums text-foreground">
                  {route.distance.toFixed(1)} km
                </dd>
              </>
            )}
          </dl>
        )}
        {poi && !vehicle && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd className="text-right capitalize text-foreground">{poi.type}</dd>
          </dl>
        )}
      </div>
    </aside>
  );
}

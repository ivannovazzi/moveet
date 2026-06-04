import { cn } from "@/lib/utils";
import type { VehicleType } from "@/types";

const VEHICLE_TYPES: { type: VehicleType; label: string; color: string }[] = [
  { type: "car", label: "Car", color: "#dcdcdc" },
  { type: "truck", label: "Truck", color: "#f59e0b" },
  { type: "motorcycle", label: "Moto", color: "#8b5cf6" },
  { type: "ambulance", label: "Ambulance", color: "#ef4444" },
  { type: "bus", label: "Bus", color: "#3b82f6" },
];

interface TypeLegendProps {
  hiddenVehicleTypes: Set<VehicleType>;
  onToggle: (type: VehicleType) => void;
}

export default function TypeLegend({ hiddenVehicleTypes, onToggle }: TypeLegendProps) {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-2 rounded-lg border border-border bg-card/80 p-3 shadow-lg backdrop-blur-md">
      {VEHICLE_TYPES.map(({ type, label, color }) => (
        <div
          key={type}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent/10",
            hiddenVehicleTypes.has(type) && "opacity-40"
          )}
          onClick={() => onToggle(type)}
          title={hiddenVehicleTypes.has(type) ? `Show ${label}` : `Hide ${label}`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
          <span className="whitespace-nowrap text-sm text-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}

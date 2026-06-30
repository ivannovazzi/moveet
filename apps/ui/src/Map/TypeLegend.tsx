import { cn } from "@/lib/utils";
import type { VehicleType } from "@/types";

// Swatch colors reference the shared --color-vehicle-* tokens (tokens.css) so
// the legend stays in sync with the deck.gl VehiclesLayer sprite colors.
const VEHICLE_TYPES: { type: VehicleType; label: string; color: string }[] = [
  { type: "car", label: "Car", color: "var(--color-vehicle-car)" },
  { type: "truck", label: "Truck", color: "var(--color-vehicle-truck)" },
  { type: "motorcycle", label: "Moto", color: "var(--color-vehicle-motorcycle)" },
  { type: "ambulance", label: "Ambulance", color: "var(--color-vehicle-ambulance)" },
  { type: "bus", label: "Bus", color: "var(--color-vehicle-bus)" },
];

interface TypeLegendProps {
  hiddenVehicleTypes: Set<VehicleType>;
  onToggle: (type: VehicleType) => void;
}

export default function TypeLegend({ hiddenVehicleTypes, onToggle }: TypeLegendProps) {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-2 rounded-lg border border-border surface-glass p-3 shadow-elevated backdrop-blur-md">
      {VEHICLE_TYPES.map(({ type, label, color }, i) => {
        const hidden = hiddenVehicleTypes.has(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={!hidden}
            className={cn(
              "flex animate-fade-up cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-left transition-colors duration-fast ease-standard hover:bg-accent/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hidden && "opacity-40"
            )}
            style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
            title={hidden ? `Show ${label}` : `Hide ${label}`}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="whitespace-nowrap text-sm tracking-tight text-foreground">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

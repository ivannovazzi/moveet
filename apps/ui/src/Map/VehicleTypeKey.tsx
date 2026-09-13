import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { VehicleType } from "@/types";
import {
  AmbulanceIcon,
  Bus,
  CarIcon,
  FilterIcon,
  MotorcycleIcon,
  TruckIcon,
} from "@/components/Icons";

/**
 * The five vehicle types, in the order the flyout spreads them.
 *
 * `color` references the shared `--color-vehicle-*` tokens (tokens.css) that
 * `VehiclesLayer` resolves for the sprites, so the tinted icons are the map's
 * colour key as well as its filter — which is what the old bottom-left legend
 * box was really for.
 */
const VEHICLE_TYPES: { type: VehicleType; label: string; icon: ReactNode; color: string }[] = [
  { type: "car", label: "Car", icon: <CarIcon />, color: "var(--color-vehicle-car)" },
  { type: "truck", label: "Truck", icon: <TruckIcon />, color: "var(--color-vehicle-truck)" },
  {
    type: "motorcycle",
    label: "Moto",
    icon: <MotorcycleIcon />,
    color: "var(--color-vehicle-motorcycle)",
  },
  {
    type: "ambulance",
    label: "Ambulance",
    icon: <AmbulanceIcon />,
    color: "var(--color-vehicle-ambulance)",
  },
  { type: "bus", label: "Bus", icon: <Bus />, color: "var(--color-vehicle-bus)" },
];

export interface VehicleTypeKeyProps {
  hiddenVehicleTypes: Set<VehicleType>;
  onToggle: (type: VehicleType) => void;
}

/**
 * One rail key that holds five: the vehicle-type filters, spread on demand.
 *
 * Five permanent keys for types would be half the rail's height spent on a
 * filter that is left alone most of the time, so they collapse into a funnel key
 * that spreads them rightward when pressed. Press again, Escape, or a click
 * outside closes it; Tab still reaches the type keys, and focus leaving the
 * cluster closes it, so a keyboard gets the same cluster a pointer does.
 *
 * Deliberately NOT on hover: the rail is a column of keys the pointer crosses
 * on its way to any of them, so a hover trigger flashed the spread open on the
 * way past, and hover-open fighting click-toggle left the cluster stuck open
 * after a click-then-leave. One press, one state.
 *
 * A count on the key reports how many types are currently filtered out: with the
 * cluster collapsed, the fact that a filter is on at all has to survive on the
 * key itself, or vehicles go missing from the map with nothing on screen saying
 * why (the legend box used to carry that by being permanently visible).
 */
export default function VehicleTypeKey({ hiddenVehicleTypes, onToggle }: VehicleTypeKeyProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hiddenCount = hiddenVehicleTypes.size;
  const filtering = hiddenCount > 0;

  // Focus opens the cluster so Tab reaches the type keys; a blur that lands
  // outside the wrapper closes it again.
  const onBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }, []);

  // Dismissal while open: a press anywhere else, or Escape. Same pattern as
  // `SearchBar` — the mousedown lands before the key's own click, so the
  // contains() guard is what keeps a press on the key a toggle rather than a
  // close-then-reopen.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node | null)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Claim the press so the app-level Escape doesn't also clear the
      // selection underneath the cluster.
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative flex flex-col items-center" onBlur={onBlur}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Vehicle types"
        title={filtering ? `Vehicle types — ${hiddenCount} hidden` : "Vehicle types — all shown"}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(
          "relative flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md",
          "transition-[background-color,color] duration-fast ease-standard",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "[&_svg]:relative [&_svg]:size-4",
          filtering || open
            ? "bg-accent/[0.10] text-accent"
            : "text-muted-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground"
        )}
      >
        {(filtering || open) && (
          <span aria-hidden className="absolute inset-1.5 rounded-full bg-accent/25 blur-[8px]" />
        )}
        <FilterIcon />
        {filtering && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center",
              "rounded-full border-[1.5px] border-glass-bot bg-accent px-[3px]",
              "font-mono text-micro font-bold leading-none tabular-nums text-white"
            )}
          >
            {hiddenCount}
            <span className="sr-only">{hiddenCount} vehicle types hidden</span>
          </span>
        )}
      </button>

      {open && (
        // `pl-2` rather than `ml-2`: the gap belongs to the flyout, so a press
        // in it counts as inside the cluster.
        <div className="absolute left-full top-0 z-10 pl-2">
          <div
            role="group"
            aria-label="Vehicle type filters"
            className="flex animate-fade-in-fast gap-0.5 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated"
          >
            {VEHICLE_TYPES.map(({ type, label, icon, color }) => {
              const hidden = hiddenVehicleTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={!hidden}
                  aria-label={label}
                  title={hidden ? `Show ${label}` : `Hide ${label}`}
                  onClick={() => onToggle(type)}
                  style={hidden ? undefined : { color }}
                  className={cn(
                    "flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-md",
                    "transition-[background-color,color,opacity] duration-fast ease-standard",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "[&_svg]:size-4",
                    hidden
                      ? "text-muted-foreground/45 hover:bg-foreground/[0.05] hover:text-muted-foreground"
                      : "bg-foreground/[0.04] hover:bg-foreground/[0.08]"
                  )}
                >
                  {icon}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

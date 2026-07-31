import { Fragment, useEffect, useState } from "react";
import { Range } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { TRAIL_LENGTH_RANGE, useTrailLength } from "@/hooks/useTrailLength";
import type { Modifiers, VehicleType } from "@/types";
import VehicleTypeKey from "./VehicleTypeKey";
import { VISIBILITY_LAYERS } from "./visibilityLayers";

export interface VisibilityRailProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
  /** Vehicle-type filters, spread from the rail's funnel key. */
  hiddenVehicleTypes: Set<VehicleType>;
  onToggleVehicleType: (type: VehicleType) => void;
}

/**
 * What the map draws, as one column of lit keys on the left edge.
 *
 * Icons only. Ten labelled switches in a panel three clicks away is a lot of
 * furniture for ten booleans the operator flips while watching the map — as keys
 * they are one press each, always in the same place, and the lit/unlit column
 * reads as the current state of the map at a glance. This is why the Settings
 * dock no longer has a Visibility tab: two places to flip the same ten flags is
 * how the palette's copy of the list drifted in the first place.
 *
 * Not every filter is a boolean: the vehicle types are five, so they collapse
 * into one key that spreads them (see `VehicleTypeKey`), seated right under the
 * Vehicles layer they narrow. Trails likewise carries its length.
 *
 * Left edge, vertically centred: the only stretch of that side nothing else
 * claims (the density scale sits top-left, the fleet legend bottom-right).
 */
export default function VisibilityRail({
  modifiers,
  onChangeModifiers,
  hiddenVehicleTypes,
  onToggleVehicleType,
}: VisibilityRailProps) {
  const trail = useTrailLength();
  const [trailOpen, setTrailOpen] = useState(false);
  const trailsOn = modifiers.showBreadcrumbs;

  // Turning trails off takes its slider with it, rather than leaving a popover
  // open over a layer that is no longer drawn.
  useEffect(() => {
    if (!trailsOn) setTrailOpen(false);
  }, [trailsOn]);

  return (
    <div
      role="group"
      aria-label="Layer visibility"
      className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 animate-fade-up flex-col gap-0.5 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated"
    >
      {VISIBILITY_LAYERS.map(({ key, label, icon }) => {
        // Density and Jobs are optional modifiers (absent = off), so coerce.
        const on = modifiers[key] ?? false;
        const isTrails = key === "showBreadcrumbs";
        return (
          <Fragment key={key}>
            <div className={isTrails ? "relative flex flex-col items-center" : undefined}>
              <button
                type="button"
                aria-pressed={Boolean(on)}
                aria-label={label}
                title={on ? `Hide ${label}` : `Show ${label}`}
                onClick={() => onChangeModifiers(key)(!on)}
                className={cn(
                  "relative flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md",
                  "transition-[background-color,color] duration-fast ease-standard",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "[&_svg]:relative [&_svg]:size-4",
                  on
                    ? "bg-accent/[0.10] text-accent"
                    : "text-muted-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground"
                )}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute inset-1.5 rounded-full bg-accent/25 blur-[8px]"
                  />
                )}
                {icon}
              </button>

              {/* Trails is the one layer with a parameter. Its length rides a chip
                under the key — a readout that is also the way to change it —
                rather than a slider parked in the rail for a layer that is off
                most of the time. */}
              {isTrails && trailsOn && (
                <>
                  <button
                    type="button"
                    aria-label="Trail length"
                    aria-expanded={trailOpen}
                    title={`Trail length: ${trail.value} points`}
                    onClick={() => setTrailOpen((open) => !open)}
                    className={cn(
                      "mt-0.5 cursor-pointer rounded px-1 py-px font-mono text-[9.5px] font-bold leading-[13px] tabular-nums",
                      "transition-colors duration-fast ease-standard",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      trailOpen
                        ? "bg-accent/15 text-accent"
                        : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    )}
                  >
                    {trail.value}
                  </button>
                  {trailOpen && (
                    <div className="absolute left-full top-0 z-10 ml-2 w-[184px] animate-fade-in-fast rounded-lg border border-border surface-glass glass-frost p-3 shadow-elevated">
                      <Range
                        label="Trail Length"
                        value={trail.value}
                        min={TRAIL_LENGTH_RANGE.min}
                        max={TRAIL_LENGTH_RANGE.max}
                        step={TRAIL_LENGTH_RANGE.step}
                        onChange={trail.set}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Seated under the layer it narrows: the types filter which
                vehicles arrive at all, so it belongs to Vehicles, not to the
                overlays below it. */}
            {key === "showVehicles" && (
              <VehicleTypeKey
                hiddenVehicleTypes={hiddenVehicleTypes}
                onToggle={onToggleVehicleType}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

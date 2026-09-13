import { Fragment, useEffect, useId, useState } from "react";
import { Range } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { TRAIL_LENGTH_RANGE, useTrailLength } from "@/hooks/useTrailLength";
import { DENSITY_MIN_VEHICLES } from "./Vehicle/densityView";
import type { Modifiers, VehicleType } from "@/types";
import VehicleTypeKey from "./VehicleTypeKey";
import { VISIBILITY_LAYERS } from "./visibilityLayers";

export interface VisibilityRailProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
  /** Vehicle-type filters, spread from the rail's funnel key. */
  hiddenVehicleTypes: Set<VehicleType>;
  onToggleVehicleType: (type: VehicleType) => void;
  /**
   * Live fleet size. Density only engages above `DENSITY_MIN_VEHICLES`, so the
   * rail needs the count to say why a lit Density key is drawing nothing.
   *
   * Only the fleet-size half of `shouldAggregate` is covered here, on purpose.
   * The other half is zoom, which lives in the deck.gl view state inside
   * `DeckGLMap` — the rail is App-level furniture and would need that state
   * lifted and re-rendered on every wheel tick to report it. Fleet size is the
   * half that stays wrong for minutes at a time (a small sim never reaches the
   * threshold at all); zoom is one gesture away from fixing itself, and the
   * plate appearing as you zoom out is its own feedback.
   */
  vehicleCount: number;
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
 * Bottom-left, standing on the dock shelf and growing *upward*. Legends grow
 * *downward* from under the search bar (see `LegendStack`, whose max-height
 * reserves this band), so however many overlays are lit the two columns run
 * out of room before they can overlap — which a vertically-centred rail did
 * not: at a 1000px window the traffic legend landed on top of it.
 */
export default function VisibilityRail({
  modifiers,
  onChangeModifiers,
  hiddenVehicleTypes,
  onToggleVehicleType,
  vehicleCount,
}: VisibilityRailProps) {
  const trail = useTrailLength();
  const densityHintId = useId();
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
      className="absolute left-3 bottom-[calc(var(--spacing-above-dock)+0.75rem)] z-10 flex animate-fade-up flex-col gap-0.5 rounded-lg border border-border surface-glass glass-frost p-1 shadow-elevated"
    >
      {VISIBILITY_LAYERS.map(({ key, label, icon }) => {
        // Density and Jobs are optional modifiers (absent = off), so coerce.
        const on = modifiers[key] ?? false;
        const isTrails = key === "showBreadcrumbs";
        // Density silently draws nothing below its vehicle threshold, which
        // read as a broken toggle. Lit-but-inert is now a visible state: the
        // key dims and carries the count it is waiting for.
        const densityStarved =
          key === "showDensity" && Boolean(on) && vehicleCount < DENSITY_MIN_VEHICLES;
        const starvedTitle = `Density — needs ${DENSITY_MIN_VEHICLES}+ vehicles (${vehicleCount} now)`;
        const starvedHint = `needs ${DENSITY_MIN_VEHICLES}+ vehicles, ${vehicleCount} now`;
        return (
          <Fragment key={key}>
            <div
              className={
                isTrails || densityStarved ? "relative flex flex-col items-center" : undefined
              }
            >
              <button
                type="button"
                aria-pressed={Boolean(on)}
                aria-label={label}
                // The chip itself is the description, so point at it rather
                // than duplicating the sentence in an `aria-description` (still
                // only a draft attribute, and unsupported by most screen
                // readers). `aria-pressed` stays true: the layer *is* on, it is
                // the data that hasn't arrived.
                aria-describedby={densityStarved ? densityHintId : undefined}
                title={densityStarved ? starvedTitle : on ? `Hide ${label}` : `Show ${label}`}
                onClick={() => onChangeModifiers(key)(!on)}
                className={cn(
                  "relative flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md",
                  "transition-[background-color,color] duration-fast ease-standard",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "[&_svg]:relative [&_svg]:size-4",
                  on
                    ? "bg-accent/[0.10] text-accent"
                    : "text-muted-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground",
                  densityStarved && "opacity-55"
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

              {/* The threshold Density is waiting for, on the same chip the
                  trail length uses — but a plain span: there is nothing to
                  press, it is a readout of why the layer is idle. It is also
                  the key's accessible description, so it spells the shorthand
                  out for a reader who can't see the dimmed key next to it. */}
              {densityStarved && (
                <span
                  id={densityHintId}
                  data-testid="density-threshold-chip"
                  className="mt-0.5 rounded px-1 py-px font-mono text-[9.5px] font-bold leading-[13px] tabular-nums text-muted-foreground"
                >
                  <span aria-hidden>{`${DENSITY_MIN_VEHICLES}+`}</span>
                  <span className="sr-only">{starvedHint}</span>
                </span>
              )}

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

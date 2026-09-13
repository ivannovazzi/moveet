import { useState } from "react";
import { Slider } from "@/components/ui/slider";

export interface ZoneIntensityControlProps {
  /** The selected zone's committed intensity, 0–1. */
  value: number;
  /** Called with the new 0–1 intensity on every drag step (editor debounces). */
  onChange: (intensity: number) => void;
}

/**
 * The heat zone's intensity, inline in the mode rail.
 *
 * This used to be a floating panel of its own (`HeatzoneInspector`) that also
 * carried Delete and Close — the same two acts the rail already offered, in a
 * second place. The slider was the only thing the panel had that the rail did
 * not, so the slider moved to the rail and the panel went away.
 *
 * Local state gives the drag immediate feedback; the editor debounces the PATCH
 * behind `onChange`. Mount it with a key per zone so switching zones
 * re-initialises the slider rather than carrying the previous zone's value.
 */
export default function ZoneIntensityControl({ value, onChange }: ZoneIntensityControlProps) {
  const [pct, setPct] = useState(() => Math.round(value * 100));

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-micro uppercase tracking-wider text-muted-foreground/70">
        Intensity
      </span>
      <Slider
        className="w-24"
        value={[pct]}
        min={0}
        max={100}
        step={1}
        aria-label="Intensity"
        onValueChange={([v]) => {
          setPct(v);
          onChange(v / 100);
        }}
      />
      <span className="w-[3ch] text-right font-mono text-meta font-semibold tabular-nums text-foreground">
        {pct}
      </span>
    </div>
  );
}

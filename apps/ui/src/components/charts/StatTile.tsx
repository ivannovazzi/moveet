import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Eyebrow } from "@/Dock/DockPanelKit";
import { cn } from "@/lib/utils";
import { Sparkline, type SparkPoint } from "./Sparkline";

/** Whether an increase in this measure is a good thing. */
export type DeltaPolarity = "up-is-good" | "down-is-good" | "neutral";

export interface StatDelta {
  /** Signed change, in the value's own unit. */
  value: number;
  /** Pre-formatted magnitude, e.g. `"1.4"` — the sign is added here. */
  text: string;
  polarity?: DeltaPolarity;
  /** What the change is measured against, e.g. `"vs 5m ago"`. */
  since?: string;
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Unit suffix, rendered de-emphasised next to the value. */
  unit?: string;
  delta?: StatDelta | null;
  /**
   * Trend series for the sparkline. Fewer than 2 readings renders no spark.
   * `null` entries are gaps in the measure, not zeros.
   */
  trend?: SparkPoint[];
  className?: string;
}

/**
 * Threshold below which a change reads as "no movement". Analytics values are
 * floating-point rolling averages, so an exact 0 delta is rare even when the
 * fleet is idle — without this the tile would flicker between ↑ and ↓.
 */
const FLAT_EPSILON = 1e-6;

function deltaTone(delta: StatDelta): { className: string; Icon: typeof ArrowUp; sign: string } {
  if (Math.abs(delta.value) < FLAT_EPSILON) {
    return { className: "text-muted-foreground", Icon: Minus, sign: "" };
  }
  const rising = delta.value > 0;
  const polarity = delta.polarity ?? "neutral";
  const good = polarity === "neutral" ? null : polarity === "up-is-good" ? rising : !rising;

  return {
    className:
      good === null ? "text-muted-foreground" : good ? "text-status-ok" : "text-status-error",
    Icon: rising ? ArrowUp : ArrowDown,
    sign: rising ? "+" : "−",
  };
}

/**
 * A headline number with an optional signed delta and a 2px trend spark.
 *
 * The value is the chart — there is no one-bar bar chart here. Direction is
 * carried by an arrow glyph *and* a signed number as well as by colour, so the
 * status hue never has to do the work alone.
 */
export function StatTile({ label, value, unit, delta, trend, className }: StatTileProps) {
  const tone = delta ? deltaTone(delta) : null;

  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5 px-2.5 py-3", className)}
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <Eyebrow>{label}</Eyebrow>
      <div className="flex items-baseline gap-1">
        {/* Proportional figures: tabular-nums makes a large standalone number
            look loose, and nothing here has to align into a column. */}
        <span className="truncate text-[21px] font-semibold leading-none tracking-[-0.015em] text-foreground">
          {value}
        </span>
        {unit ? <span className="text-[12px] text-muted-foreground">{unit}</span> : null}
      </div>

      {tone && delta ? (
        <div
          className={cn("flex items-center gap-1 text-[10.5px] font-medium", tone.className)}
          data-testid="stat-delta"
        >
          <tone.Icon aria-hidden="true" className="size-3 shrink-0" />
          <span className="tabular-nums">
            {tone.sign}
            {delta.text}
          </span>
          {delta.since ? (
            <span className="truncate font-normal text-muted-foreground">{delta.since}</span>
          ) : null}
        </div>
      ) : null}

      {trend && trend.length >= 2 ? (
        <div className="mt-0.5 flex">
          <Sparkline data={trend} height={22} />
        </div>
      ) : null}
    </div>
  );
}

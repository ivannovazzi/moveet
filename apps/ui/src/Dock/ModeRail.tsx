import { cn } from "@/lib/utils";
import { StatusDot, toneTextClass } from "./DockPanelKit";
import { RailButton, RailLabel, RailSpinner } from "./DockBarKit";
import type { ModeDescriptor } from "./modeDescriptors";

export interface ModeRailProps {
  descriptor: ModeDescriptor;
}

/**
 * The dock's centre slot while a map mode is active: what the mode is, what it
 * is holding, what to do next, and the two ways out — all in the spot the
 * operator is already watching for transport state.
 *
 * This replaces the top-of-map `ModeBanner` and the Fleet panel's
 * `DispatchStatusBar`. Those told the same story in two places (and, for heat
 * zones, in none at all), so a mode could be left running with its panel closed
 * and no visible way back.
 */
export default function ModeRail({ descriptor }: ModeRailProps) {
  const { label, icon, tone, status, hint, primary, exit, exitLabel, busy, locksPan } = descriptor;
  const toneText = toneTextClass(tone);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-center gap-2.5 pl-2.5 pr-1.5"
    >
      <span className={cn("flex shrink-0 items-center gap-1.5", toneText)}>
        {busy ? <RailSpinner /> : <StatusDot tone={tone} />}
        <span className="flex items-center [&_svg]:size-[15px]">{icon}</span>
        <RailLabel>{label}</RailLabel>
      </span>

      {status && (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-[11.5px] font-semibold tabular-nums",
            toneText
          )}
        >
          {status}
        </span>
      )}

      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground" title={hint}>
        {hint}
      </span>

      {locksPan && (
        <span className="hidden shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 xl:flex">
          <LockGlyph />
          Pan off
        </span>
      )}

      {/* Some modes finish and leave by the same act (heat zones: "Done"), so
          the rail shows one button rather than two identical ones — the
          descriptor still carries the primary so Enter keeps working. */}
      {primary && primary.label !== exitLabel && (
        <RailButton
          variant="primary"
          keycap="⏎"
          disabled={!primary.enabled || busy}
          onClick={primary.run}
        >
          {primary.label}
        </RailButton>
      )}

      <RailButton variant="quiet" keycap="Esc" onClick={exit} disabled={busy}>
        {exitLabel}
      </RailButton>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor">
      <rect x="3.5" y="7" width="9" height="6" rx="1.5" strokeWidth="1.4" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

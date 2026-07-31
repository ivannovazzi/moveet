import { cn } from "@/lib/utils";
import { StatusDot, toneTextClass } from "./DockPanelKit";
import { RailButton, RailLabel, RailSpinner } from "./DockBarKit";
import type { ModeDescriptor } from "./modeDescriptors";

export interface ModeRailProps {
  descriptor: ModeDescriptor;
}

/**
 * The work dock while a map mode is active: what the mode is, what it is
 * holding, what to do next, and the two ways out — reading left to right in
 * that order, so the buttons always land in the same place at the right edge.
 *
 * This replaces the top-of-map `ModeBanner` and the Fleet panel's
 * `DispatchStatusBar`. Those told the same story in two places (and, for heat
 * zones, in none at all), so a mode could be left running with its panel closed
 * and no visible way back.
 *
 * It sizes to its content, and it carries no instructions. The prose hint that
 * used to sit here ("Click vehicles on the map or in Fleet") was a banner in a
 * bar of keys: it read as the widest thing in the dock, said the same sentence
 * for minutes at a time, and every state it described is already legible from
 * the tone, the status readout, the spinner, the Pan-off flag and whether the
 * primary button is live.
 */
export default function ModeRail({ descriptor }: ModeRailProps) {
  const { label, icon, tone, status, actions, primary, exit, exitLabel, busy, locksPan } =
    descriptor;
  const toneText = toneTextClass(tone);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[42px] min-w-0 items-center gap-2.5 pl-2.5 pr-0.5"
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

      {/* Now the only thing in the rail that isn't a key or a count — and it
          earns it: with no hint text left, this is what says panning is off. */}
      {locksPan && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
          <LockGlyph />
          Pan off
        </span>
      )}

      {/* The mode's own side actions, before the two that end it. */}
      {actions?.map((action) => (
        <RailButton
          key={action.label}
          variant="quiet"
          disabled={!action.enabled || busy}
          onClick={action.run}
        >
          {action.label}
        </RailButton>
      ))}

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

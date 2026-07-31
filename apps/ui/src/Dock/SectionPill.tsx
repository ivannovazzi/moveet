import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { DockBadge, DockSection } from "./dockSections";

export interface SectionPillProps {
  section: DockSection;
  /** This section's buttons are open in the dock. */
  active: boolean;
  badge?: DockBadge;
  onClick: () => void;
}

/**
 * One of the four section keys: icon only, always in the same place.
 *
 * Selected state is a *lit key* rather than a filled chip — the icon takes the
 * accent, a soft glow sits behind it, and a 2px accent bar seats at the bottom
 * edge, where the section's own buttons come out. It reads at 17px in a way a
 * background tint does not, and it points at where the expansion happens.
 */
const SectionPill = forwardRef<HTMLButtonElement, SectionPillProps>(function SectionPill(
  { section, active, badge, onClick },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={active}
      aria-controls="dock-section-panel"
      aria-label={section.label}
      title={badge ? `${section.label} — ${badge.label}` : section.label}
      onClick={onClick}
      className={cn(
        "group relative flex size-[42px] shrink-0 items-center justify-center self-center rounded-[10px]",
        "transition-[background-color,color,box-shadow] duration-fast ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "[&_svg]:relative [&_svg]:size-[17px]",
        active
          ? "bg-accent/[0.10] text-accent"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      )}
    >
      {/* glow behind the glyph, only when lit */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 inset-y-2 rounded-full bg-accent/25 blur-[10px]"
        />
      )}
      {section.icon}
      {/* the key's lit edge, seated where its buttons unfold */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-[9px] bottom-[3px] h-[2px] rounded-full transition-[opacity,transform] duration-normal ease-emphasized",
          active
            ? "bg-accent opacity-100 shadow-[0_0_8px_var(--color-accent)]"
            : "scale-x-50 bg-accent opacity-0"
        )}
      />
      {badge && badge.count > 0 && (
        <span
          className={cn(
            "absolute -right-0.5 top-0 flex h-[15px] min-w-[15px] items-center justify-center rounded-full",
            "border-[1.5px] border-glass-bot px-[3px] font-mono text-[9px] font-bold leading-none tabular-nums text-white",
            badge.tone === "error" ? "bg-status-error" : "bg-accent"
          )}
        >
          {badge.count > 9 ? "9+" : badge.count}
          <span className="sr-only">{badge.label}</span>
        </span>
      )}
    </button>
  );
});

export default SectionPill;

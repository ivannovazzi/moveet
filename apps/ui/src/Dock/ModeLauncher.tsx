import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import { MODE_LAUNCH_ITEMS } from "./modeDescriptors";
import { Kbd } from "./DockBarKit";

export interface ModeLauncherProps {
  /** Starts a map mode. Already guarded by the caller. */
  onStart: (kind: InteractionModeKind) => void;
  /** Nothing can be started while the simulator is unreachable. */
  disabled?: boolean;
}

/**
 * The dock's browse-state centre slot: one menu holding every way to put the
 * map into a mode, with the same bare-key shortcuts the keyboard dispatcher
 * honours. The panels keep their own entry buttons — this is the surface that
 * makes the set discoverable without knowing which panel owns which tool.
 */
export default function ModeLauncher({ onStart, disabled = false }: ModeLauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Start a map action"
            className={cn(
              "flex h-[42px] items-center gap-2 rounded-[10px] pl-3 pr-3.5",
              "text-[11px] font-bold uppercase tracking-[0.08em]",
              "transition-[background-color,color,box-shadow] duration-fast ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "disabled:pointer-events-none disabled:opacity-40",
              open
                ? "bg-accent/[0.14] text-accent shadow-[inset_0_0_0_1px_var(--color-accent-line,oklch(0.62_0.15_250/0.30))]"
                : "text-accent/90 hover:bg-accent/[0.10] hover:text-accent"
            )}
          >
            <PlusGlyph />
            New
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={12}
          className="w-80 border-border surface-glass-strong p-1 shadow-floating backdrop-blur-2xl"
        >
          <ul className="flex flex-col">
            {MODE_LAUNCH_ITEMS.map((item) => (
              <li key={item.kind}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onStart(item.kind);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left",
                    "transition-colors duration-fast ease-standard hover:bg-accent/12",
                    "focus-visible:outline-none focus-visible:bg-accent/12"
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05] text-muted-foreground transition-colors duration-fast group-hover:text-accent [&_svg]:size-[15px]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                  <Kbd>{item.shortcut}</Kbd>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor">
      <path d="M8 3.5v9M3.5 8h9" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

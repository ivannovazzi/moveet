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
    <div className="flex w-full items-center justify-between gap-2 pl-1 pr-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Start a map action"
            className={cn(
              "flex h-8 items-center gap-2 rounded-lg border border-border-soft bg-foreground/[0.04] pl-2.5 pr-3",
              "text-[12px] font-medium text-foreground",
              "transition-[background-color,border-color,color] duration-fast ease-standard",
              "hover:border-accent/40 hover:bg-accent/10 hover:text-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "disabled:pointer-events-none disabled:opacity-40",
              open && "border-accent/40 bg-accent/10 text-accent"
            )}
          >
            <PlusGlyph />
            New action
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

      <span className="hidden items-center gap-1.5 text-[10.5px] text-muted-foreground/70 lg:flex">
        Search
        <Kbd>⌘K</Kbd>
      </span>
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

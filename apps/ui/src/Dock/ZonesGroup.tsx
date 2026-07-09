import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { DrawIcon, SeedIcon, TrashIcon } from "@/components/Icons";
import { useHeatzoneEditorContext } from "@/data/HeatzoneEditorContext";

/** A 36×42 dock icon button — matches PlaybackCluster's `.ibtn`. */
function IconBtn({
  active,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex h-[42px] w-9 items-center justify-center rounded-lg text-muted-foreground",
        "transition-[color,background-color] duration-fast ease-standard",
        "hover:bg-foreground/[0.035] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        "[&_svg]:size-[17px]",
        active && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Dock "Zones" tool group — replaces the old flame generate-zones button.
 * Draw (lasso, toggles editor draw mode) · Seed random · Clear all. Reads the
 * shared heatzone editor from context so no props thread through the dock.
 */
export default function ZonesGroup() {
  const editor = useHeatzoneEditorContext();

  const handleClear = useCallback(() => {
    if (window.confirm("Remove all heat zones? This cannot be undone.")) {
      editor.clearAll();
    }
  }, [editor]);

  return (
    <div className="flex items-center gap-[3px]">
      <IconBtn
        active={editor.isDrawing}
        onClick={editor.toggleDraw}
        aria-label="Draw heat zone"
        title="Draw heat zone (freehand lasso)"
      >
        <DrawIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.seed()}
        aria-label="Seed random zones"
        title="Seed random zones"
      >
        <SeedIcon />
      </IconBtn>
      <IconBtn onClick={handleClear} aria-label="Clear all zones" title="Clear all zones">
        <TrashIcon />
      </IconBtn>
    </div>
  );
}

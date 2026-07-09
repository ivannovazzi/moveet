import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useHeatzoneEditorContext } from "@/data/HeatzoneEditorContext";
import { HeatZone as HeatZoneIcon, TrashIcon } from "@/components/Icons";
import { PanelBody, PanelEmptyState } from "./PanelPrimitives";

/**
 * Heat Zones section (a Monitor tab). Authoring lives here rather than in the
 * primary transport dock: heat zones are a secondary control. Drawing, seeding,
 * and clearing are driven through the shared `useHeatzoneEditor` context, and
 * the list mirrors the map - click a row to select/edit it (the on-map inspector
 * handles intensity + delete too). This mirrors the GeofencePanel pattern.
 */
export default function HeatzonePanel() {
  const zones = useHeatzones();
  const editor = useHeatzoneEditorContext();

  const handleClear = useCallback(() => {
    if (zones.length === 0) return;
    if (window.confirm("Remove all heat zones? This cannot be undone.")) editor.clearAll();
  }, [zones.length, editor]);

  return (
    <PanelBody className="gap-3">
      {/* Draw control */}
      {editor.isDrawing ? (
        <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/10 p-3">
          <span className="text-xs leading-snug text-muted-foreground">
            Drag on the map to lasso a zone. The map is locked while drawing.
          </span>
          <button
            type="button"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            onClick={editor.stopDraw}
            title="Stop drawing"
          >
            Done
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="w-full rounded-md surface-accent px-3 py-2 text-left text-sm font-medium text-primary-foreground shadow-raised transition-[transform,background-color,box-shadow,color] duration-fast ease-standard hover:shadow-glow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98]"
          onClick={editor.startDraw}
          title="Draw a heat zone on the map (freehand lasso)"
        >
          + Draw zone
        </button>
      )}

      {/* Bulk actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:border-accent/30 hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          onClick={() => editor.seed()}
          title="Append randomly generated zones"
        >
          Seed random
        </button>
        <button
          type="button"
          disabled={zones.length === 0}
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors duration-fast ease-standard hover:border-status-error/30 hover:bg-status-error/10 hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-40"
          onClick={handleClear}
          title="Remove all heat zones"
        >
          Clear all
        </button>
      </div>

      {/* Zone list */}
      {zones.length === 0 ? (
        <PanelEmptyState icon={<HeatZoneIcon />}>
          No heat zones. Draw one on the map, or seed random zones.
        </PanelEmptyState>
      ) : (
        <ul className="rounded-md border border-border-soft">
          {zones.map((z, i) => {
            const selected = z.properties.id === editor.selectedId;
            return (
              <li
                key={z.properties.id}
                className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-border-soft px-2 first:border-t-0"
              >
                <button
                  type="button"
                  className="min-w-0 py-[9px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                  onClick={() => editor.select(z.properties.id)}
                  title="Select this zone on the map"
                >
                  <div
                    className={cn(
                      "truncate text-[12px] font-medium",
                      selected ? "text-accent" : "text-foreground"
                    )}
                  >
                    {`Heat zone ${i + 1}`}
                    {selected && " · editing"}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                    {Math.round(z.properties.intensity * 100)}% intensity
                  </div>
                </button>
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast ease-standard hover:bg-status-error/10 hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent [&_svg]:size-[15px]"
                  onClick={() => editor.remove(z.properties.id)}
                  aria-label={`Delete heat zone ${i + 1}`}
                  title="Delete zone"
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelBody>
  );
}

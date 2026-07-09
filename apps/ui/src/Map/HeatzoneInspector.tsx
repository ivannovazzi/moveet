import { useState } from "react";
import { cn } from "@/lib/utils";
import { Range } from "@/components/Inputs";
import { CloseIcon, TrashIcon } from "@/components/Icons";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useHeatzoneEditorContext } from "@/data/HeatzoneEditorContext";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";
import type { Heatzone } from "@/types";

/**
 * Floating panel for the currently selected heat zone: an intensity slider
 * (debounced PATCH via the editor) and a delete action. Anchored above the dock
 * so it never overlaps the transport bar. Renders nothing when no zone is
 * selected.
 */
export default function HeatzoneInspector() {
  const editor = useHeatzoneEditorContext();
  const heatzones = useHeatzones();

  const zone = editor.selectedId
    ? heatzones.find((z) => z.properties.id === editor.selectedId)
    : undefined;

  if (!zone) return null;
  // Keyed on the zone id so the slider's local state re-initialises (fresh
  // useState) whenever a different zone is selected - no sync effect needed.
  return <HeatzonePanel key={zone.properties.id} zone={zone} editor={editor} />;
}

function HeatzonePanel({ zone, editor }: { zone: Heatzone; editor: HeatzoneEditor }) {
  const id = zone.properties.id;
  // Local slider value (0–100) for immediate feedback; the editor debounces the
  // PATCH round-trip.
  const [pct, setPct] = useState(() => Math.round(zone.properties.intensity * 100));

  return (
    <div
      className={cn(
        "absolute bottom-24 left-1/2 z-50 w-64 -translate-x-1/2",
        "rounded-xl border border-border surface-glass shadow-elevated backdrop-blur-xl",
        "p-3"
      )}
      role="group"
      aria-label="Heat zone controls"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-foreground">Heat Zone</span>
        <button
          type="button"
          onClick={editor.deselect}
          aria-label="Close"
          title="Close"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground [&_svg]:size-3.5"
        >
          <CloseIcon />
        </button>
      </div>

      <Range
        label="Intensity"
        value={pct}
        min={0}
        max={100}
        step={1}
        onChange={(v) => {
          setPct(v);
          editor.setIntensity(id, v / 100);
        }}
      />

      <button
        type="button"
        onClick={() => editor.remove(id)}
        aria-label="Delete zone"
        title="Delete zone"
        className={cn(
          "mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2",
          "text-[12px] font-medium text-status-error",
          "border border-status-error/30 hover:bg-status-error/10",
          "transition-colors duration-fast ease-standard [&_svg]:size-3.5"
        )}
      >
        <TrashIcon />
        Delete zone
      </button>
    </div>
  );
}

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Range } from "@/components/Inputs";
import { useHeatzones } from "@/hooks/useHeatzones";
import { useHeatzoneEditorContext } from "@/data/HeatzoneEditorContext";
import type { HeatzoneEditor } from "@/hooks/useHeatzoneEditor";
import type { Heatzone } from "@/types";

/**
 * Floating panel for the currently selected heat zone: the intensity slider
 * (debounced PATCH via the editor) and nothing else. Delete and Done live on
 * the dock's mode rail (describeHeatzoneEdit) — this panel used to repeat both,
 * which gave the same two acts two homes and made the rail look optional.
 * Anchored above the dock so it never overlaps the transport bar. Renders
 * nothing when no zone is selected.
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
        "rounded-xl border border-border surface-glass glass-frost shadow-elevated",
        "p-3"
      )}
      role="group"
      aria-label="Heat zone controls"
    >
      <div className="mb-2 text-[12px] font-semibold text-foreground">Heat zone intensity</div>

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
    </div>
  );
}

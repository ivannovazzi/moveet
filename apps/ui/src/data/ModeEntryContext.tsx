import { createContext, useContext, type ReactNode } from "react";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";

/**
 * The one guarded way into a map mode.
 *
 * Panels deep in the tree (the heat-zone tab, the geofence tab, the job board)
 * each used to call their own tool's `start()` directly, which meant a click in
 * one panel could silently throw away a half-drawn polygon owned by another.
 * They call this instead, so every entry point runs the same mode guard as the
 * dock's launcher and the keyboard shortcuts.
 */
export interface ModeEntry {
  start: (kind: InteractionModeKind) => void;
}

const ModeEntryContext = createContext<ModeEntry | null>(null);

export function ModeEntryProvider({ value, children }: { value: ModeEntry; children: ReactNode }) {
  return <ModeEntryContext.Provider value={value}>{children}</ModeEntryContext.Provider>;
}

export function useModeEntry(): ModeEntry {
  const ctx = useContext(ModeEntryContext);
  if (!ctx) throw new Error("useModeEntry must be used within a ModeEntryProvider");
  return ctx;
}

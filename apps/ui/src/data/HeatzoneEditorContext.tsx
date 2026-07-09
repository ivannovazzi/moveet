import { createContext, useContext, type ReactNode } from "react";
import { useHeatzoneEditor, type HeatzoneEditor } from "@/hooks/useHeatzoneEditor";

/**
 * Shares one `useHeatzoneEditor()` instance across the three subtrees that all
 * need the same editor state: the map layer (draw/reshape/move), the dock Zones
 * tool group (draw/seed/clear), and the floating selection inspector (intensity
 * slider + delete). A context avoids threading a large editor object through the
 * dock's already-wide prop surface.
 */
const HeatzoneEditorContext = createContext<HeatzoneEditor | null>(null);

export function HeatzoneEditorProvider({ children }: { children: ReactNode }) {
  const editor = useHeatzoneEditor();
  return <HeatzoneEditorContext.Provider value={editor}>{children}</HeatzoneEditorContext.Provider>;
}

export function useHeatzoneEditorContext(): HeatzoneEditor {
  const ctx = useContext(HeatzoneEditorContext);
  if (!ctx) {
    throw new Error("useHeatzoneEditorContext must be used within a HeatzoneEditorProvider");
  }
  return ctx;
}

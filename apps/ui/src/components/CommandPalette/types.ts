import type { ReactNode } from "react";

/**
 * One runnable entry in the command palette's "Actions" group. Actions are
 * built in `commands.tsx` from the handlers the app already owns — the palette
 * itself never talks to the client or holds domain state.
 */
export interface PaletteAction {
  /** Stable identity; also the React key and the `aria-activedescendant` id. */
  id: string;
  /** What the operator reads and types against. */
  label: string;
  /** Extra searchable words that are matched but never displayed. */
  keywords?: string;
  /** Short right-aligned category ("Simulation", "Panel", "Visibility"…). */
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

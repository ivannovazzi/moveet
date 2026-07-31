import { useCallback, useMemo, useState } from "react";

/**
 * Identifiers for the dock clusters. Owned here (rather than by a UI component)
 * so any cluster or panel component can depend on the id union without
 * importing `Dock.tsx`.
 *
 * The set is grouped by what the operator is doing, not by which service owns
 * the data: `fleet` is the roster and its work, `monitor` is what is happening
 * right now, `session` is the run itself (recordings, scenarios), and
 * `settings` is configuration (view filters, feeds & sinks, tuning). The old
 * `sinks-source` cluster is gone — adapter health reads on the status chips and
 * its configuration is a Settings tab, so the bar carries no service jargon.
 */
export type DockClusterId = "tempo" | "fleet" | "monitor" | "session" | "settings";

/**
 * Cluster ids that own a panel. Lives here rather than in `Dock.tsx` because
 * App needs the same predicate to tell the keyboard dispatcher whether Escape
 * has a panel to close.
 */
export const PANEL_CLUSTERS = new Set<DockClusterId>([
  "tempo",
  "fleet",
  "monitor",
  "session",
  "settings",
]);

export interface DockNavigation {
  /** The single cluster whose drawer is currently open, or `null`. */
  openCluster: DockClusterId | null;
  /** True when the open cluster actually renders a panel surface. */
  panelOpen: boolean;
  /** Open a specific cluster's drawer, closing any other. */
  open: (cluster: DockClusterId) => void;
  /** Close whichever drawer is open. */
  close: () => void;
  /** Open `cluster` if it isn't the currently-open one; close it if it is. */
  toggle: (cluster: DockClusterId) => void;
  /** Convenience predicate for a cluster's active/open visual state. */
  isOpen: (cluster: DockClusterId) => boolean;
}

/**
 * Tracks which single dock cluster's drawer is open. Modeled on
 * `usePanelNavigation`'s shape, simplified since the dock has no side-panel
 * routing — just single-open-at-a-time drawer state.
 *
 * Called once in `App.tsx` (not by `Dock`) and handed to *both* `Dock` and the
 * command palette's action list, so the two share one source of truth and the
 * app's keyboard dispatcher can route Escape to `close()` as its
 * lowest-priority branch. (It used to be called inside `Dock.tsx`; the palette
 * had no handler to call and drove the dock's buttons through
 * `document.querySelector` on their aria-labels.)
 *
 * The returned object is memoized on `openCluster` so callers can put it
 * straight into a `useMemo`/`useCallback` dependency list.
 */
export function useDockNavigation(): DockNavigation {
  const [openCluster, setOpenCluster] = useState<DockClusterId | null>(null);

  const open = useCallback((cluster: DockClusterId) => {
    setOpenCluster(cluster);
  }, []);

  const close = useCallback(() => {
    setOpenCluster(null);
  }, []);

  const toggle = useCallback((cluster: DockClusterId) => {
    setOpenCluster((current) => (current === cluster ? null : cluster));
  }, []);

  const isOpen = useCallback((cluster: DockClusterId) => openCluster === cluster, [openCluster]);

  return useMemo(
    () => ({
      openCluster,
      panelOpen: openCluster != null && PANEL_CLUSTERS.has(openCluster),
      open,
      close,
      toggle,
      isOpen,
    }),
    [openCluster, open, close, toggle, isOpen]
  );
}

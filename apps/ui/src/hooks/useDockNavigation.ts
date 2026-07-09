import { useCallback, useState } from "react";

/**
 * Identifiers for the dock clusters (see
 * `docs/plans/2026-07-07-dock-ui-redesign-design.md`). Owned here (rather
 * than by a UI component) so any cluster or panel component can depend on the
 * id union without importing `Dock.tsx`. `monitor` is observe-only (incidents,
 * analytics, geofences); `settings` holds view filters, session, and tuning.
 */
export type DockClusterId =
  | "playback"
  | "tempo"
  | "fleet-dispatch"
  | "sinks-source"
  | "monitor"
  | "settings";

export interface DockNavigation {
  /** The single cluster whose drawer is currently open, or `null`. */
  openCluster: DockClusterId | null;
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

  return { openCluster, open, close, toggle, isOpen };
}

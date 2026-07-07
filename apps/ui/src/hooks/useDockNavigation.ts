import { useCallback, useState } from "react";

/**
 * Identifiers for the five dock clusters (see
 * `docs/plans/2026-07-07-dock-ui-redesign-design.md`). Owned here (rather
 * than by a UI component, as `PanelId` is by `IconRail`) so any cluster or
 * drawer component can depend on the id union without importing `Dock.tsx`.
 */
export type DockClusterId = "playback" | "tempo" | "fleet-dispatch" | "sinks-source" | "monitor";

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

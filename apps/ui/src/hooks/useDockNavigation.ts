import { useCallback, useMemo, useRef, useState } from "react";
import { defaultTab, sectionHasTab, type DockSectionId, type DockTabId } from "@/Dock/dockSections";

/**
 * What the dock row is showing.
 *
 * `expanded` is the section that has turned itself into a dock; `tab` is the
 * button selected inside it, which is also the panel that is open. There is no
 * separate "panel open" flag: a section is expanded or it is a pill, and an
 * expanded section always has exactly one tab selected. That is what makes the
 * row deterministic — no state where the bar is expanded but showing nothing,
 * and no state where a panel floats over a collapsed pill.
 *
 * Tempo is deliberately not a section: its button lives in the main dock and
 * anchors its own panel there, because tempo is a clock control rather than a
 * place to go.
 */
export interface DockNavigation {
  /** The section currently expanded into a dock, or `null`. */
  expanded: DockSectionId | null;
  /** The selected tab of the expanded section, or `null` when collapsed. */
  tab: DockTabId | null;
  /** True while the Tempo details panel is open (main dock, not a section). */
  tempoOpen: boolean;
  /** True while the deck's "New" mode launcher menu is open. */
  launcherOpen: boolean;

  /** Expand `section`, optionally jumping straight to one of its tabs. */
  open: (section: DockSectionId, tab?: DockTabId) => void;
  /** Collapse whichever section is expanded (and close the tempo panel). */
  close: () => void;
  /** Expand `section` if it isn't the expanded one; collapse it if it is. */
  toggle: (section: DockSectionId) => void;
  /** Select a tab within the expanded section. */
  selectTab: (tab: DockTabId) => void;
  /** Open/close the main dock's Tempo details panel. */
  toggleTempo: () => void;
  /** Open/close the deck's mode launcher. Opening it closes everything else. */
  setLauncherOpen: (open: boolean) => void;
  /** Toggle the launcher from its own key. */
  toggleLauncher: () => void;

  isExpanded: (section: DockSectionId) => boolean;
  /** True when any panel surface is open — Escape's lowest-priority target. */
  panelOpen: boolean;
}

export function useDockNavigation(): DockNavigation {
  const [expanded, setExpanded] = useState<DockSectionId | null>(null);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [launcherOpen, setLauncher] = useState(false);
  // Remembered per section so coming back to Monitor lands where you left it.
  // The section's *shape* never varies; only which of its fixed buttons is lit.
  const [lastTab, setLastTab] = useState<Partial<Record<DockSectionId, DockTabId>>>({});

  const open = useCallback((section: DockSectionId, tab?: DockTabId) => {
    setTempoOpen(false);
    setLauncher(false);
    setExpanded(section);
    if (tab && sectionHasTab(section, tab)) {
      setLastTab((prev) => ({ ...prev, [section]: tab }));
    }
  }, []);

  const close = useCallback(() => {
    setExpanded(null);
    setTempoOpen(false);
    setLauncher(false);
  }, []);

  const toggle = useCallback((section: DockSectionId) => {
    setTempoOpen(false);
    setLauncher(false);
    setExpanded((current) => (current === section ? null : section));
  }, []);

  // Read through refs rather than nesting a setState inside another updater —
  // under StrictMode an updater runs twice, so a side effect in one fires twice.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const tempoRef = useRef(tempoOpen);
  tempoRef.current = tempoOpen;
  const launcherRef = useRef(launcherOpen);
  launcherRef.current = launcherOpen;

  const selectTab = useCallback((tab: DockTabId) => {
    const section = expandedRef.current;
    if (!section || !sectionHasTab(section, tab)) return;
    setLastTab((prev) => ({ ...prev, [section]: tab }));
  }, []);

  const toggleTempo = useCallback(() => {
    const opening = !tempoRef.current;
    // Tempo, the launcher and an expanded section are three surfaces floating
    // over the same map; only one of them is ever open, so opening tempo takes
    // the other two away.
    if (opening) {
      setExpanded(null);
      setLauncher(false);
    }
    setTempoOpen(opening);
  }, []);

  const setLauncherOpen = useCallback((next: boolean) => {
    if (next) {
      setExpanded(null);
      setTempoOpen(false);
    }
    setLauncher(next);
  }, []);

  const toggleLauncher = useCallback(() => {
    setLauncherOpen(!launcherRef.current);
  }, [setLauncherOpen]);

  const isExpanded = useCallback((section: DockSectionId) => expanded === section, [expanded]);

  const tab = expanded ? (lastTab[expanded] ?? defaultTab(expanded)) : null;

  return useMemo(
    () => ({
      expanded,
      tab,
      tempoOpen,
      launcherOpen,
      open,
      close,
      toggle,
      selectTab,
      toggleTempo,
      setLauncherOpen,
      toggleLauncher,
      isExpanded,
      panelOpen: expanded !== null || tempoOpen || launcherOpen,
    }),
    [
      expanded,
      tab,
      tempoOpen,
      launcherOpen,
      open,
      close,
      toggle,
      selectTab,
      toggleTempo,
      setLauncherOpen,
      toggleLauncher,
      isExpanded,
    ]
  );
}

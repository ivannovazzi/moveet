import { useCallback, useEffect, useState } from "react";
import type { PanelId } from "@/Controls/IconRail";

export interface PanelNavigation {
  activePanel: PanelId | null;
  setActivePanel: (panel: PanelId | null) => void;
  closePanel: () => void;
}

/**
 * Manages sidebar panel navigation state.
 * Auto-opens the vehicles panel when dispatch mode is activated.
 */
export function usePanelNavigation(dispatchMode: boolean): PanelNavigation {
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  const closePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  // Auto-open sidebar when dispatch mode is activated
  useEffect(() => {
    if (dispatchMode) {
      setActivePanel("vehicles");
    }
  }, [dispatchMode]);

  return {
    activePanel,
    setActivePanel,
    closePanel,
  };
}

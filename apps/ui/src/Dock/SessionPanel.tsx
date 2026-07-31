import type { ComponentProps } from "react";
import RecordReplay from "@/Controls/RecordReplay";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { PanelScroll } from "./DockPanelKit";
import type { SessionTabId } from "./dockSections";

export interface SessionPanelProps {
  tab: SessionTabId;
  recordings: ComponentProps<typeof RecordReplay>;
}

/**
 * Contents of the Session panel — the run itself. Recordings and scenarios
 * both *change what the simulation is doing*, so filing them under Settings
 * (next to layer visibility and physics sliders) mislabelled them as
 * preferences. The Session dock's two buttons switch between them.
 */
export default function SessionPanel({ tab, recordings }: SessionPanelProps) {
  return (
    <PanelScroll>
      <SuppressPanelHeader>
        {tab === "recordings" && <RecordReplay {...recordings} />}
        {tab === "scenarios" && <ScenariosPanel />}
      </SuppressPanelHeader>
    </PanelScroll>
  );
}

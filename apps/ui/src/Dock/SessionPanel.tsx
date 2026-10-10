import type { ComponentProps } from "react";
import RecordReplay from "@/Controls/RecordReplay";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import MapsPanel from "@/Maps/MapsPanel";
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
 * preferences. The Session dock's buttons switch between them. Maps belong
 * here for the same reason: switching the road network restarts the run.
 */
export default function SessionPanel({ tab, recordings }: SessionPanelProps) {
  return (
    <PanelScroll>
      <SuppressPanelHeader>
        {tab === "recordings" && <RecordReplay {...recordings} />}
        {tab === "scenarios" && <ScenariosPanel />}
        {tab === "maps" && <MapsPanel />}
      </SuppressPanelHeader>
    </PanelScroll>
  );
}

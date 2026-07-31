import { useState, type ComponentProps } from "react";
import RecordReplay from "@/Controls/RecordReplay";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { PanelHead, PanelScroll, PanelTabStrip, type PanelTab } from "./DockPanelKit";

export interface SessionPanelProps {
  recordings: ComponentProps<typeof RecordReplay>;
}

type SessionTabId = "recordings" | "scenarios";

/**
 * Session panel — the run itself. Recordings and scenarios both *change what
 * the simulation is doing*, so filing them under Settings (next to layer
 * visibility and physics sliders) mislabelled them as preferences. They live
 * here, one cluster away from the transport controls that share their job.
 */
export default function SessionPanel({ recordings }: SessionPanelProps) {
  const [tab, setTab] = useState<SessionTabId>("recordings");

  const tabs: PanelTab<SessionTabId>[] = [
    { id: "recordings", label: "Recordings" },
    { id: "scenarios", label: "Scenarios" },
  ];
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "Recordings";

  return (
    <>
      <PanelHead eyebrow="Session" title={activeLabel} />
      <PanelTabStrip tabs={tabs} value={tab} onChange={setTab} ariaLabel="Session sections" />
      <PanelScroll>
        <SuppressPanelHeader>
          {tab === "recordings" && <RecordReplay {...recordings} />}
          {tab === "scenarios" && <ScenariosPanel />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

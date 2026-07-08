import { useState, type ComponentProps } from "react";
import TogglesPanel from "@/Controls/TogglesPanel";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import RecordReplay from "@/Controls/RecordReplay";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import { PanelHead, PanelScroll, PanelTabStrip, type PanelTab } from "./DockPanelKit";

export interface SettingsPanelProps {
  toggles: ComponentProps<typeof TogglesPanel>;
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
}

type SettingsTabId = "visibility" | "scenarios" | "recordings" | "advanced";

/**
 * Settings panel — configure & view. The things that are *not* live monitoring:
 * layer/vehicle-type visibility filters, scenario presets, recordings, and the
 * advanced vehicle-physics/cadence tuning. Split out of Monitor so filters and
 * configuration no longer sit among the observe-only surfaces.
 */
export default function SettingsPanel({ toggles, recordings, advanced }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTabId>("visibility");

  const tabs: PanelTab<SettingsTabId>[] = [
    { id: "visibility", label: "Visibility" },
    { id: "scenarios", label: "Scenarios" },
    { id: "recordings", label: "Recordings" },
    { id: "advanced", label: "Advanced" },
  ];
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "Visibility";

  return (
    <>
      <PanelHead eyebrow="Settings" title={activeLabel} />
      <PanelTabStrip tabs={tabs} value={tab} onChange={setTab} ariaLabel="Settings sections" />
      <PanelScroll>
        <SuppressPanelHeader>
          {tab === "visibility" && <TogglesPanel {...toggles} />}
          {tab === "scenarios" && <ScenariosPanel />}
          {tab === "recordings" && <RecordReplay {...recordings} />}
          {tab === "advanced" && <AdvancedTuningTab {...advanced} />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

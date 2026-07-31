import { useState, type ComponentProps } from "react";
import TogglesPanel from "@/Controls/TogglesPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import FeedsSection, { FEED_HEALTH_TONE, feedHealth } from "./FeedsSection";
import { HealthChip, PanelHead, PanelScroll, PanelTabStrip, type PanelTab } from "./DockPanelKit";

export interface SettingsPanelProps {
  toggles: ComponentProps<typeof TogglesPanel>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
  feeds: ComponentProps<typeof FeedsSection>;
}

type SettingsTabId = "visibility" | "feeds" | "advanced";

/**
 * Settings panel — configuration, and only configuration: what the map draws,
 * where telemetry is published, and how the vehicles behave. Recordings and
 * scenarios moved to the Session cluster (they change the run, not a
 * preference), which leaves this panel with one honest job.
 */
export default function SettingsPanel({ toggles, advanced, feeds }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTabId>("visibility");

  const tabs: PanelTab<SettingsTabId>[] = [
    { id: "visibility", label: "Visibility" },
    { id: "feeds", label: "Feeds & sinks" },
    { id: "advanced", label: "Advanced" },
  ];
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "Visibility";
  const health = feedHealth(feeds.adapter.health);

  return (
    <>
      <PanelHead
        eyebrow="Settings"
        title={activeLabel}
        right={
          tab === "feeds" ? (
            <HealthChip tone={FEED_HEALTH_TONE[health]}>{health}</HealthChip>
          ) : undefined
        }
      />
      <PanelTabStrip tabs={tabs} value={tab} onChange={setTab} ariaLabel="Settings sections" />
      <PanelScroll>
        <SuppressPanelHeader>
          {tab === "visibility" && <TogglesPanel {...toggles} />}
          {tab === "feeds" && <FeedsSection {...feeds} />}
          {tab === "advanced" && <AdvancedTuningTab {...advanced} />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

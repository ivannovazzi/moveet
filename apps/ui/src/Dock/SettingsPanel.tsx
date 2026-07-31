import type { ComponentProps } from "react";
import TogglesPanel from "@/Controls/TogglesPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import FeedsSection, { FEED_HEALTH_TONE, feedHealth } from "./FeedsSection";
import { HealthChip, PanelScroll } from "./DockPanelKit";
import type { SettingsTabId } from "./dockSections";

export interface SettingsPanelProps {
  tab: SettingsTabId;
  toggles: ComponentProps<typeof TogglesPanel>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
  feeds: ComponentProps<typeof FeedsSection>;
}

/**
 * Contents of the Settings panel — configuration, and only configuration: what
 * the map draws, where telemetry is published, how the vehicles behave.
 * Recordings and scenarios live in the Session dock (they change the run, not a
 * preference).
 */
export default function SettingsPanel({ tab, toggles, advanced, feeds }: SettingsPanelProps) {
  const health = feedHealth(feeds.adapter.health);

  return (
    <>
      {tab === "feeds" && (
        <div className="flex items-center justify-end px-[15px] pb-1 pt-2.5">
          <HealthChip tone={FEED_HEALTH_TONE[health]}>{health}</HealthChip>
        </div>
      )}
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

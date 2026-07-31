import type { ComponentProps } from "react";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import FeedsSection, { FEED_HEALTH_TONE, feedHealth } from "./FeedsSection";
import { HealthChip, PanelScroll } from "./DockPanelKit";
import type { SettingsTabId } from "./dockSections";

export interface SettingsPanelProps {
  tab: SettingsTabId;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
  feeds: ComponentProps<typeof FeedsSection>;
}

/**
 * Contents of the Settings panel — configuration, and only configuration: where
 * telemetry is published, and how the vehicles behave. What the map *draws* is
 * not a panel at all any more: it is the icon rail on the map's left edge
 * (`Map/VisibilityRail`). Recordings and scenarios live in the Session dock
 * (they change the run, not a preference).
 */
export default function SettingsPanel({ tab, advanced, feeds }: SettingsPanelProps) {
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
          {tab === "feeds" && <FeedsSection {...feeds} />}
          {tab === "advanced" && <AdvancedTuningTab {...advanced} />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

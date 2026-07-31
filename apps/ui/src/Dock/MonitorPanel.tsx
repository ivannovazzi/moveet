import type { ComponentProps } from "react";
import Incidents from "@/Controls/Incidents";
import AnalyticsPanel from "@/Controls/AnalyticsPanel";
import GeofencePanel from "@/Controls/GeofencePanel";
import HeatzonePanel from "@/Controls/HeatzonePanel";
import FaultsPanel from "@/Controls/FaultsPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { PanelScroll } from "./DockPanelKit";
import type { MonitorTabId } from "./dockSections";

export interface MonitorPanelProps {
  tab: MonitorTabId;
  incidents: ComponentProps<typeof Incidents>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  geofences: ComponentProps<typeof GeofencePanel>;
  faults: ComponentProps<typeof FaultsPanel>;
}

/**
 * Contents of the Monitor panel — everything here is something you *watch*:
 * live incidents, fleet analytics, geofences, heat zones, device faults. Each
 * leaf also carries the controls that produce what it watches, because the
 * thing observed and the knob that causes it belong side by side.
 *
 * The section switch is the Monitor dock's row of buttons; this renders the lit
 * one. Leaves render their own `PanelHeader`, which `SuppressPanelHeader`
 * collapses (the dock bar already names the view) while keeping their in-body
 * controls intact.
 */
export default function MonitorPanel({
  tab,
  incidents,
  analytics,
  geofences,
  faults,
}: MonitorPanelProps) {
  return (
    <PanelScroll>
      <SuppressPanelHeader>
        {tab === "incidents" && <Incidents {...incidents} />}
        {tab === "analytics" && <AnalyticsPanel {...analytics} />}
        {tab === "geofences" && <GeofencePanel {...geofences} />}
        {tab === "heatzones" && <HeatzonePanel />}
        {tab === "faults" && <FaultsPanel {...faults} />}
      </SuppressPanelHeader>
    </PanelScroll>
  );
}

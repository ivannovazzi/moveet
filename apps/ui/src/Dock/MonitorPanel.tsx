import { useState, type ComponentProps } from "react";
import Incidents from "@/Controls/Incidents";
import AnalyticsPanel from "@/Controls/AnalyticsPanel";
import GeofencePanel from "@/Controls/GeofencePanel";
import HeatzonePanel from "@/Controls/HeatzonePanel";
import FaultsPanel from "@/Controls/FaultsPanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { PanelHead, PanelScroll, PanelTabStrip, type PanelTab } from "./DockPanelKit";
import { countMisbehavingDevices } from "@/lib/faultPresets";

export interface MonitorPanelProps {
  incidents: ComponentProps<typeof Incidents>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  geofences: ComponentProps<typeof GeofencePanel>;
  faults: ComponentProps<typeof FaultsPanel>;
}

type MonitorTabId = "incidents" | "analytics" | "geofences" | "heatzones" | "faults";

/**
 * Monitor panel — everything here is something you *watch*: live incidents,
 * fleet analytics, geofences (which raise enter/exit alerts), heat zones, and
 * device faults. Each tab also carries the controls that produce what it
 * watches (draw a zone, arm a fault profile), because the thing being observed
 * and the knob that causes it belong side by side. View filters, session, and
 * vehicle tuning moved to `SettingsPanel` so this cluster stays a coherent
 * "what's happening" surface.
 *
 * Leaves render their own `PanelHeader`; we already own the title, so
 * `SuppressPanelHeader` collapses the duplicate while keeping in-body controls.
 */
export default function MonitorPanel({
  incidents,
  analytics,
  geofences,
  faults,
}: MonitorPanelProps) {
  const [tab, setTab] = useState<MonitorTabId>("incidents");

  // Devices currently misbehaving — the number worth seeing without opening
  // the tab.
  const faultyDevices = countMisbehavingDevices(faults.faults.config, faults.faults.status);

  const tabs: PanelTab<MonitorTabId>[] = [
    { id: "incidents", label: "Incidents", badge: incidents.incidents.length },
    { id: "analytics", label: "Analytics" },
    { id: "geofences", label: "Geofences" },
    { id: "heatzones", label: "Heat Zones" },
    { id: "faults", label: "Faults", badge: faultyDevices },
  ];
  const activeLabel = tabs.find((t) => t.id === tab)?.label ?? "Incidents";

  return (
    <>
      <PanelHead eyebrow="Monitor" title={activeLabel} />
      <PanelTabStrip tabs={tabs} value={tab} onChange={setTab} ariaLabel="Monitor sections" />
      <PanelScroll>
        <SuppressPanelHeader>
          {tab === "incidents" && <Incidents {...incidents} />}
          {tab === "analytics" && <AnalyticsPanel {...analytics} />}
          {tab === "geofences" && <GeofencePanel {...geofences} />}
          {tab === "heatzones" && <HeatzonePanel />}
          {tab === "faults" && <FaultsPanel {...faults} />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

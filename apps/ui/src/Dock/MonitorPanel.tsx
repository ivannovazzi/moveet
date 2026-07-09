import { useState, type ComponentProps } from "react";
import Incidents from "@/Controls/Incidents";
import AnalyticsPanel from "@/Controls/AnalyticsPanel";
import GeofencePanel from "@/Controls/GeofencePanel";
import HeatzonePanel from "@/Controls/HeatzonePanel";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import { PanelHead, PanelScroll, PanelTabStrip, type PanelTab } from "./DockPanelKit";

export interface MonitorPanelProps {
  incidents: ComponentProps<typeof Incidents>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  geofences: ComponentProps<typeof GeofencePanel>;
}

type MonitorTabId = "incidents" | "analytics" | "geofences" | "heatzones";

/**
 * Monitor panel — observe-only. Everything here is something you *watch*:
 * live incidents, fleet analytics, and geofences (which raise enter/exit
 * alerts). View filters, session, and vehicle tuning moved to `SettingsPanel`
 * so this cluster stays a coherent "what's happening" surface.
 *
 * Leaves render their own `PanelHeader`; we already own the title, so
 * `SuppressPanelHeader` collapses the duplicate while keeping in-body controls.
 */
export default function MonitorPanel({ incidents, analytics, geofences }: MonitorPanelProps) {
  const [tab, setTab] = useState<MonitorTabId>("incidents");

  const tabs: PanelTab<MonitorTabId>[] = [
    { id: "incidents", label: "Incidents", badge: incidents.incidents.length },
    { id: "analytics", label: "Analytics" },
    { id: "geofences", label: "Geofences" },
    { id: "heatzones", label: "Heat Zones" },
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
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

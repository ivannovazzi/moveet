import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import Incidents from "@/Controls/Incidents";
import GeofencePanel from "@/Controls/GeofencePanel";
import AnalyticsPanel from "@/Controls/AnalyticsPanel";
import TogglesPanel from "@/Controls/TogglesPanel";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import RecordReplay from "@/Controls/RecordReplay";
import { SuppressPanelHeader } from "@/Controls/PanelPrimitives";
import AdvancedTuningTab from "./AdvancedTuningTab";
import { PanelHead, PanelScroll, mono } from "./DockPanelKit";

export interface MonitorPanelProps {
  incidents: ComponentProps<typeof Incidents>;
  geofences: ComponentProps<typeof GeofencePanel>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  toggles: ComponentProps<typeof TogglesPanel>;
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
}

type MonitorTabId =
  "incidents" | "geofences" | "analytics" | "toggles" | "scenarios" | "recordings" | "advanced";

const TABS: { id: MonitorTabId; label: string }[] = [
  { id: "incidents", label: "Incidents" },
  { id: "geofences", label: "Geofences" },
  { id: "analytics", label: "Analytics" },
  { id: "toggles", label: "Visibility" },
  { id: "scenarios", label: "Scenarios" },
  { id: "recordings", label: "Recordings" },
  { id: "advanced", label: "Advanced" },
];

/**
 * Monitor overflow panel: the dock's catch-all for everything genuinely
 * secondary (incidents, geofences, analytics, visibility toggles, scenarios,
 * recordings, advanced tuning). Renders the shared `PanelHead` (title tracks
 * the active tab) plus a Monitor-specific horizontally-scrollable mini tab
 * strip (the mockup's `.mtabs`, deliberately kept out of the equal-width
 * `SegTabs`), then the active leaf.
 *
 * The leaves each render their own `PanelHeader`; here we already own the
 * title, so we wrap the leaf in `<SuppressPanelHeader>` to collapse that
 * duplicate while keeping the leaf's in-body controls (filters, buttons,
 * sub-tabs) intact.
 */
export default function MonitorPanel({
  incidents,
  geofences,
  analytics,
  toggles,
  recordings,
  advanced,
}: MonitorPanelProps) {
  const [tab, setTab] = useState<MonitorTabId>("incidents");
  const incidentCount = incidents.incidents.length;
  const activeLabel = TABS.find((t) => t.id === tab)?.label ?? "Incidents";

  return (
    <>
      <PanelHead eyebrow="Monitor" title={activeLabel} />

      {/* Monitor mini tab strip (mockup `.mtabs`): quiet, scrollable, no
          equal-width stretch — there are seven of them. */}
      <div
        role="tablist"
        aria-label="Monitor tabs"
        className="flex gap-0.5 overflow-x-auto border-b border-border-soft px-2.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map(({ id, label }) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(id)}
              className={cn(
                "flex-shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[10.5px] font-medium",
                "transition-[color,background-color] duration-fast ease-standard",
                selected
                  ? "bg-foreground/[0.06] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
              )}
            >
              {label}
              {id === "incidents" && incidentCount > 0 && (
                <span className={cn(mono, "ml-1 text-[9px] text-status-error")}>
                  {incidentCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <PanelScroll>
        <SuppressPanelHeader>
          {tab === "incidents" && <Incidents {...incidents} />}
          {tab === "geofences" && <GeofencePanel {...geofences} />}
          {tab === "analytics" && <AnalyticsPanel {...analytics} />}
          {tab === "toggles" && <TogglesPanel {...toggles} />}
          {tab === "scenarios" && <ScenariosPanel />}
          {tab === "recordings" && <RecordReplay {...recordings} />}
          {tab === "advanced" && <AdvancedTuningTab {...advanced} />}
        </SuppressPanelHeader>
      </PanelScroll>
    </>
  );
}

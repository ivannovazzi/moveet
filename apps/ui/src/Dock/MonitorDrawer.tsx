import { useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  AlertIcon,
  GeofenceIcon,
  ChartIcon,
  EyeIcon,
  ScenarioIcon,
  RecordCircleIcon,
  GaugeIcon,
} from "@/components/Icons";
import Incidents from "@/Controls/Incidents";
import GeofencePanel from "@/Controls/GeofencePanel";
import AnalyticsPanel from "@/Controls/AnalyticsPanel";
import TogglesPanel from "@/Controls/TogglesPanel";
import ScenariosPanel from "@/Controls/ScenariosPanel";
import RecordReplay from "@/Controls/RecordReplay";
import DockCluster from "./DockCluster";
import DockDrawer from "./DockDrawer";
import AdvancedTuningTab from "./AdvancedTuningTab";

// Props are lifted straight from each existing panel's own prop type
// (`ComponentProps<typeof X>`) rather than re-declared, so this file stays
// in sync with those panels without needing them to export their prop
// interfaces or be edited themselves.
type IncidentsTabProps = ComponentProps<typeof Incidents>;
type GeofencesTabProps = ComponentProps<typeof GeofencePanel>;
type AnalyticsTabProps = ComponentProps<typeof AnalyticsPanel>;
type TogglesTabProps = ComponentProps<typeof TogglesPanel>;
type RecordingsTabProps = ComponentProps<typeof RecordReplay>;
type AdvancedTabProps = ComponentProps<typeof AdvancedTuningTab>;

export interface MonitorDrawerProps {
  /** Whether this drawer is the dock's currently-open drawer. */
  isOpen: boolean;
  /** Toggle this drawer open/closed (mirrors `useDockNavigation().toggle`). */
  onToggle: () => void;
  /** Close this drawer (mirrors `useDockNavigation().close`). */
  onClose: () => void;
  incidents: IncidentsTabProps;
  geofences: GeofencesTabProps;
  analytics: AnalyticsTabProps;
  toggles: TogglesTabProps;
  recordings: RecordingsTabProps;
  advanced: AdvancedTabProps;
}

type MonitorTabId =
  "incidents" | "geofences" | "analytics" | "toggles" | "scenarios" | "recordings" | "advanced";

const TABS: {
  id: MonitorTabId;
  label: string;
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}[] = [
  { id: "incidents", label: "Incidents", Icon: AlertIcon },
  { id: "geofences", label: "Geofences", Icon: GeofenceIcon },
  { id: "analytics", label: "Analytics", Icon: ChartIcon },
  { id: "toggles", label: "Visibility", Icon: EyeIcon },
  { id: "scenarios", label: "Scenarios", Icon: ScenarioIcon },
  { id: "recordings", label: "Recordings", Icon: RecordCircleIcon },
  { id: "advanced", label: "Advanced", Icon: GaugeIcon },
];

/**
 * Monitor cluster: the dock's overflow drawer bundling everything genuinely
 * secondary (see the design doc's "Monitor cluster" section) — Incidents,
 * Geofences, Analytics, Visibility toggles, Scenarios, Recordings, and the
 * new Advanced (vehicle-physics) tab. Each tab's panel content is reused
 * as-is; only the mounting point changes (was a standalone `IconRail`
 * side-panel, now a tab inside this anchored drawer).
 *
 * Owns its own trigger `DockCluster` + anchored `DockDrawer` (see
 * `Dock.tsx`'s per-cluster `relative` wrapper pattern) so it can be dropped
 * into that wrapper independently. Open/close state is still owned by the
 * shared `useDockNavigation()` in `Dock.tsx` — this component only renders
 * against `isOpen`/`onToggle`/`onClose`.
 */
export default function MonitorDrawer({
  isOpen,
  onToggle,
  onClose,
  incidents,
  geofences,
  analytics,
  toggles,
  recordings,
  advanced,
}: MonitorDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<MonitorTabId>("incidents");

  // Badge count + cap carried over verbatim from `Controls/IconRail.tsx`'s
  // incident badge (9+ cap, red pill), now surfaced on the Monitor cluster
  // trigger itself rather than the old per-item rail button.
  const incidentCount = incidents.incidents.length;

  return (
    // `relative` so `DockDrawer`'s `absolute bottom-full` anchors directly
    // above this trigger even if a caller doesn't already wrap it in a
    // positioned ancestor (`Dock.tsx`'s per-cluster wrapper already is one,
    // but nesting another `relative` here is harmless and keeps this
    // component correct when mounted standalone).
    <div className="relative">
      <DockCluster
        ref={triggerRef}
        icon={<ChartIcon />}
        label="Monitor"
        active={isOpen}
        aria-label="Monitor"
        onClick={onToggle}
        badge={
          incidentCount > 0 ? (
            <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-[3px] text-[9px] font-semibold leading-none text-white">
              {incidentCount > 9 ? "9+" : incidentCount}
            </span>
          ) : undefined
        }
      />
      <DockDrawer
        open={isOpen}
        onClose={onClose}
        anchorRef={triggerRef}
        align="center"
        aria-label="Monitor"
        className="flex w-[380px] flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex flex-shrink-0 overflow-x-auto border-b border-border"
            role="tablist"
            aria-label="Monitor tabs"
          >
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cn(
                  "-mb-px flex flex-shrink-0 flex-col items-center gap-1 border-b-2 border-transparent px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground",
                  tab === id && "border-accent text-foreground"
                )}
                onClick={() => setTab(id)}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {tab === "incidents" && <Incidents {...incidents} />}
            {tab === "geofences" && <GeofencePanel {...geofences} />}
            {tab === "analytics" && <AnalyticsPanel {...analytics} />}
            {tab === "toggles" && <TogglesPanel {...toggles} />}
            {tab === "scenarios" && <ScenariosPanel />}
            {tab === "recordings" && <RecordReplay {...recordings} />}
            {tab === "advanced" && <AdvancedTuningTab {...advanced} />}
          </div>
        </div>
      </DockDrawer>
    </div>
  );
}

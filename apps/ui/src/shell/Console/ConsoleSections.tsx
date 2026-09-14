import { useCallback, type ComponentProps } from "react";
import type { DockNavigation } from "@/hooks/useDockNavigation";
import type { Fleet, ReplayStatus, Vehicle } from "@/types";
import type { DispatchFlow } from "@/hooks/useDispatchFlow";
import SectionTabs from "@/Dock/SectionTabs";
import FleetPanel from "@/Dock/FleetPanel";
import MonitorPanel from "@/Dock/MonitorPanel";
import SessionPanel from "@/Dock/SessionPanel";
import SettingsPanel from "@/Dock/SettingsPanel";
import type AdvancedTuningTab from "@/Dock/AdvancedTuningTab";
import {
  dockSection,
  type DockBadges,
  type DockTabId,
  type FleetTabId,
  type MonitorTabId,
  type SessionTabId,
  type SettingsTabId,
} from "@/Dock/dockSections";
import type Incidents from "@/Controls/Incidents";
import type GeofencePanel from "@/Controls/GeofencePanel";
import type AnalyticsPanel from "@/Controls/AnalyticsPanel";
import type RecordReplay from "@/Controls/RecordReplay";
import type { useAdapterConfig } from "@/Controls/Adapter/useAdapterConfig";
import Inspector, { inspectorTitle } from "@/Inspector/Inspector";
import type { Fleet as FleetType, JobDTO, POI } from "@/types";
import Console from "./Console";

/**
 * What the console is showing: one of the four sections, on the tab the
 * operator last left it on.
 *
 * The section registry (`dockSections`) is unchanged and still the single place
 * a tab is declared. What changed is where its panel appears — these are the
 * same four panel components that used to float above the dock's right wing,
 * rendered into a docked column instead. The dock's section keys still open
 * them; they now select a console tab rather than opening a surface of their
 * own (see `Console`).
 */
export interface ConsoleSectionsProps {
  navigation: DockNavigation;
  badges: DockBadges;
  /**
   * Selecting a tab. Not `navigation.selectTab` directly: some tabs are also
   * mode decisions (Fleet's Dispatch), so App wraps it.
   */
  onSelectTab: (tab: DockTabId) => void;

  // Fleet
  vehicles: Vehicle[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedId?: string;
  onSelectVehicle: (id: string) => void;
  onHoverVehicle: (id: string) => void;
  onUnhoverVehicle: () => void;
  maxSpeed: number;
  vehicleFleetMap: Map<string, Fleet>;
  fleets: Fleet[];
  onCreateFleet: (name: string) => Promise<void>;
  onDeleteFleet: (id: string) => Promise<void>;
  onAssignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  onUnassignVehicle: (fleetId: string, vehicleId: string) => Promise<void>;
  fleetsError?: string | null;
  dispatch: DispatchFlow;
  jobs: ComponentProps<typeof FleetPanel>["jobs"];

  // Monitor
  incidents: ComponentProps<typeof Incidents>;
  faults: ComponentProps<typeof MonitorPanel>["faults"];
  geofences: ComponentProps<typeof GeofencePanel>;
  analytics: ComponentProps<typeof AnalyticsPanel>;
  events: ComponentProps<typeof MonitorPanel>["events"];

  // Session / Settings
  recordings: ComponentProps<typeof RecordReplay>;
  advanced: ComponentProps<typeof AdvancedTuningTab>;
  adapter: ReturnType<typeof useAdapterConfig>;
  replayStatus: ReplayStatus;

  /**
   * What the map has selected. Its own section (see `INSPECT_SECTION`), and the
   * only one allowed to render empty — the selection can be cleared while the
   * console is open.
   */
  inspector: {
    vehicle?: Vehicle;
    poi?: POI;
    fleet?: FleetType;
    job?: JobDTO;
  };
}

export default function ConsoleSections({
  navigation,
  badges,
  onSelectTab,
  vehicles,
  filter,
  onFilterChange,
  selectedId,
  onSelectVehicle,
  onHoverVehicle,
  onUnhoverVehicle,
  maxSpeed,
  vehicleFleetMap,
  fleets,
  onCreateFleet,
  onDeleteFleet,
  onAssignVehicle,
  onUnassignVehicle,
  fleetsError,
  dispatch,
  jobs,
  incidents,
  faults,
  geofences,
  analytics,
  events,
  recordings,
  advanced,
  adapter,
  inspector,
}: ConsoleSectionsProps) {
  const { expanded, tab, close } = navigation;
  const section = expanded ? dockSection(expanded) : null;

  const body = useCallback(() => {
    if (!section || !tab) return null;
    switch (section.id) {
      case "fleet":
        return (
          <FleetPanel
            tab={tab as FleetTabId}
            vehicles={vehicles}
            filter={filter}
            onFilterChange={onFilterChange}
            selectedId={selectedId}
            onSelectVehicle={onSelectVehicle}
            onHoverVehicle={onHoverVehicle}
            onUnhoverVehicle={onUnhoverVehicle}
            maxSpeed={maxSpeed}
            vehicleFleetMap={vehicleFleetMap}
            fleets={fleets}
            onCreateFleet={onCreateFleet}
            onDeleteFleet={onDeleteFleet}
            onAssignVehicle={onAssignVehicle}
            onUnassignVehicle={onUnassignVehicle}
            fleetsError={fleetsError}
            dispatch={dispatch}
            jobs={jobs}
          />
        );
      case "monitor":
        return (
          <MonitorPanel
            tab={tab as MonitorTabId}
            incidents={incidents}
            analytics={analytics}
            geofences={geofences}
            faults={faults}
            events={events}
          />
        );
      case "session":
        return <SessionPanel tab={tab as SessionTabId} recordings={recordings} />;
      case "settings":
        return <SettingsPanel tab={tab as SettingsTabId} advanced={advanced} feeds={{ adapter }} />;
      case "inspect":
        return <Inspector {...inspector} />;
    }
  }, [
    section,
    tab,
    vehicles,
    filter,
    onFilterChange,
    selectedId,
    onSelectVehicle,
    onHoverVehicle,
    onUnhoverVehicle,
    maxSpeed,
    vehicleFleetMap,
    fleets,
    onCreateFleet,
    onDeleteFleet,
    onAssignVehicle,
    onUnassignVehicle,
    fleetsError,
    dispatch,
    jobs,
    incidents,
    faults,
    geofences,
    analytics,
    events,
    recordings,
    advanced,
    adapter,
    inspector,
  ]);

  return (
    <Console
      open={section !== null && tab !== null}
      // Inspect is named after what is selected, not after itself: "Nairobi
      // Van 12" is the answer to why the view is open, and the section's own
      // label is only the fallback for an empty selection.
      title={
        section?.id === "inspect"
          ? inspectorTitle(inspector.vehicle, inspector.poi)
          : (section?.label ?? "")
      }
      icon={section?.icon}
      bodyKey={`${expanded ?? "none"}:${tab ?? "none"}`}
      tabs={
        section && tab ? (
          <SectionTabs
            section={section}
            activeTab={tab}
            badges={badges}
            onSelectTab={onSelectTab}
          />
        ) : undefined
      }
      onClose={close}
    >
      {body()}
    </Console>
  );
}

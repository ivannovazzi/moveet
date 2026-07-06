import { SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import {
  CarIcon,
  LayersIcon,
  AlertIcon,
  RecordCircleIcon,
  EyeIcon,
  Gear,
  ChartIcon,
  GeofenceIcon,
  ScenarioIcon,
} from "@/components/Icons";

export type PanelId =
  | "vehicles"
  | "fleets"
  | "incidents"
  | "recordings"
  | "scenarios"
  | "toggles"
  | "analytics"
  | "adapter"
  | "geofences";

interface NavRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

interface NavItem {
  id: PanelId;
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: "Fleet",
    items: [
      { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
      { id: "fleets", Icon: LayersIcon, label: "Fleets" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "incidents", Icon: AlertIcon, label: "Incidents" },
      { id: "geofences", Icon: GeofenceIcon, label: "Geofences" },
      { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
      { id: "scenarios", Icon: ScenarioIcon, label: "Scenarios" },
    ],
  },
  {
    label: "Monitor",
    items: [
      { id: "toggles", Icon: EyeIcon, label: "Visibility" },
      { id: "analytics", Icon: ChartIcon, label: "Analytics" },
    ],
  },
];

const bottomItem: NavItem = { id: "adapter", Icon: Gear, label: "Adapter" };

export default function NavRail({ activePanel, onPanelChange, incidentCount }: NavRailProps) {
  const renderButton = ({ id, Icon, label }: NavItem) => (
    <SquaredButton
      key={id}
      labeled
      className="relative w-full justify-start gap-2.5 px-3 aria-pressed:before:absolute aria-pressed:before:left-0 aria-pressed:before:top-1.5 aria-pressed:before:bottom-1.5 aria-pressed:before:w-0.5 aria-pressed:before:rounded-full aria-pressed:before:bg-accent aria-pressed:before:content-['']"
      icon={<Icon />}
      iconClassName="size-4"
      size="lg"
      variant="ghost"
      tone="active"
      title={label}
      active={activePanel === id}
      onClick={() => onPanelChange(activePanel === id ? null : id)}
      aria-pressed={activePanel === id}
    >
      <span className="flex-1 text-left text-sm">{label}</span>
      {id === "incidents" && incidentCount != null && incidentCount > 0 && (
        <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-[3px] text-[9px] font-semibold leading-none text-white">
          {incidentCount > 9 ? "9+" : incidentCount}
        </span>
      )}
    </SquaredButton>
  );

  return (
    <nav
      className={cn(
        "z-[31] flex w-60 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-border-soft surface-raised px-2 py-3",
        "shadow-[4px_0_16px_-8px_rgba(0,0,0,0.5)]",
        "pointer-events-none -translate-x-4 opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
        "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-x-0 [[data-ready]_&]:opacity-100"
      )}
      aria-label="Sidebar navigation"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pb-2">
          <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </span>
          {group.items.map(renderButton)}
        </div>
      ))}
      <div className="flex-1" />
      {renderButton(bottomItem)}
    </nav>
  );
}

import { SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import {
  CarIcon,
  LayersIcon,
  AlertIcon,
  RecordCircleIcon,
  EyeIcon,
  GaugeIcon,
  Gear,
  ClockIcon,
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
  | "speed"
  | "clock"
  | "analytics"
  | "adapter"
  | "geofences";

interface IconRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

const topItems: { id: PanelId; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
  { id: "fleets", Icon: LayersIcon, label: "Fleets" },
  { id: "incidents", Icon: AlertIcon, label: "Incidents" },
  { id: "geofences", Icon: GeofenceIcon, label: "Geofences" },
  { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
  { id: "scenarios", Icon: ScenarioIcon, label: "Scenarios" },
  { id: "toggles", Icon: EyeIcon, label: "Visibility" },
  { id: "speed", Icon: GaugeIcon, label: "Speed" },
  { id: "clock", Icon: ClockIcon, label: "Simulation Clock" },
  { id: "analytics", Icon: ChartIcon, label: "Analytics" },
];

const bottomItems: typeof topItems = [{ id: "adapter", Icon: Gear, label: "Adapter" }];

export default function IconRail({ activePanel, onPanelChange, incidentCount }: IconRailProps) {
  const renderButton = ({ id, Icon, label }: (typeof topItems)[number]) => (
    <SquaredButton
      key={id}
      className="relative aria-pressed:before:absolute aria-pressed:before:-left-[7px] aria-pressed:before:top-2 aria-pressed:before:bottom-2 aria-pressed:before:w-0.5 aria-pressed:before:rounded-full aria-pressed:before:bg-accent aria-pressed:before:content-['']"
      icon={<Icon />}
      iconClassName="size-5"
      size="lg"
      variant="ghost"
      tone="active"
      active={activePanel === id}
      onClick={() => onPanelChange(activePanel === id ? null : id)}
      aria-label={label}
      aria-pressed={activePanel === id}
      title={label}
    >
      {id === "incidents" && incidentCount != null && incidentCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-[3px] text-[9px] font-semibold leading-none text-white">
          {incidentCount > 9 ? "9+" : incidentCount}
        </span>
      )}
    </SquaredButton>
  );

  return (
    <nav
      className={cn(
        "z-[31] flex w-14 flex-shrink-0 flex-col items-center gap-2 border-r border-border-soft surface-raised py-3",
        "shadow-[4px_0_16px_-8px_rgba(0,0,0,0.5)]",
        "pointer-events-none -translate-x-4 opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
        "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-x-0 [[data-ready]_&]:opacity-100"
      )}
      aria-label="Sidebar navigation"
    >
      {topItems.map(renderButton)}
      <div className="flex-1" />
      {bottomItems.map(renderButton)}
    </nav>
  );
}

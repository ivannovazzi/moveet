import { SquaredButton } from "@/components/Inputs";
import {
  CarIcon,
  LayersIcon,
  AlertIcon,
  RecordCircleIcon,
  EyeIcon,
  GaugeIcon,
  Gear,
  ClockIcon,
} from "@/components/Icons";
import styles from "./IconRail.module.css";

export type PanelId =
  | "vehicles"
  | "fleets"
  | "incidents"
  | "recordings"
  | "toggles"
  | "speed"
  | "clock"
  | "adapter";

interface IconRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

const topItems: { id: PanelId; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
  { id: "fleets", Icon: LayersIcon, label: "Fleets" },
  { id: "incidents", Icon: AlertIcon, label: "Incidents" },
  { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
  { id: "toggles", Icon: EyeIcon, label: "Visibility" },
  { id: "speed", Icon: GaugeIcon, label: "Speed" },
  { id: "clock", Icon: ClockIcon, label: "Simulation Clock" },
];

const bottomItems: typeof topItems = [{ id: "adapter", Icon: Gear, label: "Adapter" }];

export default function IconRail({ activePanel, onPanelChange, incidentCount }: IconRailProps) {
  const renderButton = ({ id, Icon, label }: (typeof topItems)[number]) => (
    <SquaredButton
      key={id}
      className={styles.railButton}
      icon={<Icon />}
      iconClassName={styles.railIcon}
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
        <span className={styles.badge}>{incidentCount > 9 ? "9+" : incidentCount}</span>
      )}
    </SquaredButton>
  );

  return (
    <nav className={styles.rail} aria-label="Sidebar navigation">
      {topItems.map(renderButton)}
      <div className={styles.spacer} />
      {bottomItems.map(renderButton)}
    </nav>
  );
}

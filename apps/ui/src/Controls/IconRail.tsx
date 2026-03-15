import classNames from "classnames";
import { CarIcon, LayersIcon, AlertIcon, RecordCircleIcon } from "@/components/Icons";
import styles from "./IconRail.module.css";

export type PanelId = "vehicles" | "fleets" | "incidents" | "recordings";

interface IconRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

const items: { id: PanelId; Icon: React.FC<React.SVGProps<SVGSVGElement>>; label: string }[] = [
  { id: "vehicles", Icon: CarIcon, label: "Vehicles" },
  { id: "fleets", Icon: LayersIcon, label: "Fleets" },
  { id: "incidents", Icon: AlertIcon, label: "Incidents" },
  { id: "recordings", Icon: RecordCircleIcon, label: "Recordings" },
];

export default function IconRail({ activePanel, onPanelChange, incidentCount }: IconRailProps) {
  return (
    <nav className={styles.rail} aria-label="Sidebar navigation">
      {items.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          className={classNames(styles.railButton, {
            [styles.railButtonActive]: activePanel === id,
          })}
          onClick={() => onPanelChange(activePanel === id ? null : id)}
          aria-label={label}
          aria-pressed={activePanel === id}
          title={label}
        >
          <Icon className={styles.railIcon} />
          {id === "incidents" && incidentCount != null && incidentCount > 0 && (
            <span className={styles.badge}>{incidentCount > 9 ? "9+" : incidentCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

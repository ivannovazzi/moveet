import classNames from "classnames";
import type { Fleet } from "@/types";
import styles from "./FleetLegend.module.css";

interface FleetLegendProps {
  fleets: Fleet[];
  hiddenFleetIds: Set<string>;
  onToggle: (fleetId: string) => void;
}

export default function FleetLegend({ fleets, hiddenFleetIds, onToggle }: FleetLegendProps) {
  if (fleets.length === 0) return null;

  return (
    <div className={styles.legend}>
      {fleets.map((fleet) => (
        <div
          key={fleet.id}
          className={classNames(styles.item, { [styles.hidden]: hiddenFleetIds.has(fleet.id) })}
          onClick={() => onToggle(fleet.id)}
          title={hiddenFleetIds.has(fleet.id) ? `Show ${fleet.name}` : `Hide ${fleet.name}`}
        >
          <span className={styles.dot} style={{ backgroundColor: fleet.color }} />
          <span className={styles.name}>{fleet.name}</span>
          <span className={styles.count}>{fleet.vehicleIds.length}</span>
        </div>
      ))}
    </div>
  );
}

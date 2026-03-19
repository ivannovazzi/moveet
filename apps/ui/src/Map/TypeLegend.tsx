import classNames from "classnames";
import type { VehicleType } from "@/types";
import styles from "./TypeLegend.module.css";

const VEHICLE_TYPES: { type: VehicleType; label: string; color: string }[] = [
  { type: "car", label: "Car", color: "#dcdcdc" },
  { type: "truck", label: "Truck", color: "#f59e0b" },
  { type: "motorcycle", label: "Moto", color: "#8b5cf6" },
  { type: "ambulance", label: "Ambulance", color: "#ef4444" },
  { type: "bus", label: "Bus", color: "#3b82f6" },
];

interface TypeLegendProps {
  hiddenVehicleTypes: Set<VehicleType>;
  onToggle: (type: VehicleType) => void;
}

export default function TypeLegend({ hiddenVehicleTypes, onToggle }: TypeLegendProps) {
  return (
    <div className={styles.legend}>
      {VEHICLE_TYPES.map(({ type, label, color }) => (
        <div
          key={type}
          className={classNames(styles.item, { [styles.hidden]: hiddenVehicleTypes.has(type) })}
          onClick={() => onToggle(type)}
          title={hiddenVehicleTypes.has(type) ? `Show ${label}` : `Hide ${label}`}
        >
          <span className={styles.dot} style={{ backgroundColor: color }} />
          <span className={styles.name}>{label}</span>
        </div>
      ))}
    </div>
  );
}

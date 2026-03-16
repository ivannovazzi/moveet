import type { Modifiers } from "@/types";
import { Switch } from "@/components/Inputs";
import { eValue } from "@/utils/form";
import { PanelBody, PanelHeader } from "./PanelPrimitives";
import styles from "./TogglesPanel.module.css";

interface TogglesPanelProps {
  modifiers: Modifiers;
  onChangeModifiers: <T extends keyof Modifiers>(name: T) => (value: Modifiers[T]) => void;
}

const toggles: { key: keyof Modifiers; label: string }[] = [
  { key: "showDirections", label: "Network" },
  { key: "showVehicles", label: "Vehicles" },
  { key: "showHeatmap", label: "Heatmap" },
  { key: "showHeatzones", label: "Zones" },
  { key: "showPOIs", label: "POIs" },
];

export default function TogglesPanel({ modifiers, onChangeModifiers }: TogglesPanelProps) {
  return (
    <>
      <PanelHeader
        title="Visibility"
        subtitle="Toggle map layers and overlays without leaving the panel."
      />
      <PanelBody className={styles.body}>
        {toggles.map(({ key, label }) => (
          <label key={key} className={styles.row}>
            <span className={styles.label}>{label}</span>
            <Switch
              checked={modifiers[key]}
              onChange={eValue(onChangeModifiers(key))}
              aria-label={label}
            />
          </label>
        ))}
      </PanelBody>
    </>
  );
}
